import { randomUUID } from "node:crypto"
import path from "node:path"
import { MINA_NETWORKS, ZEKO_M_NETWORKS } from "@zeko/networks"
import { isInsufficientFirstWithdrawalAmountError } from "@zeko-labs/bridge-sdk"
import { type CommandDef, defineCommand } from "citty"
import { PrivateKey } from "o1js"
import { type AnyStateMachine, assign, createActor, fromPromise, setup, toPromise } from "xstate"
import type { BridgeAdapter } from "../core/adapter"
import { type BridgeAdapterFactory, createDefaultBridgeAdapter } from "../core/adapter-factory"
import type { WithdrawalQueueState } from "../core/bridge-queue"
import {
	type DepositQueueState,
	getSubmitHash,
	resolveEffectiveDepositClaimableIndex,
	sortByIndex
} from "../core/bridge-queue"
import {
	type BridgeRuntimeDecision,
	decideDepositStep,
	decideWithdrawalStep
} from "../core/bridge-runtime/decisions"
import {
	createInstrumentedBridgeAdapter,
	createVerboseDiagnostics,
	mergeVerboseDiagnosticsFromSessions,
	withCapabilityWaitReason,
	withPhaseTiming
} from "../core/bridge-runtime/instrumentation"
import {
	readAliasedNumberArg,
	readAliasedOptionalNumberArg,
	readBooleanArg,
	readOptionalStringArg,
	readRequiredStringArg
} from "../core/command-args"
import { createOperationLogger } from "../core/logger"
import { isRecoverableMutationError } from "../core/mutation-errors"
import { resolveAppPaths } from "../core/paths"
import { renderBridgeResult, renderOperationProgress, toBridgeJsonResult } from "../core/reporter"
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_MS, retryWithBackoff } from "../core/retry"
import { type ChainRef, formatRoute, parseChainRef, resolveRoute } from "../core/routes"
import { createSessionStore, type SessionStore } from "../core/session-store"
import { resolveSignerKeys } from "../core/signer"
import {
	getWithdrawalStatusSourceSnapshot,
	toWithdrawalStatusSourceLogDetails
} from "../core/status-sources"
import { resolveDepositTimeoutSlots } from "../core/timeouts"
import type {
	BridgeCapabilityDiagnostic,
	BridgeSdkOperation,
	OperationPhase,
	OperationSession
} from "../core/types"

type LogFn = (entry: {
	event: string
	phase: OperationPhase
	details?: Record<string, unknown>
}) => Promise<void>

type BridgeFlowDeps = {
	adapter: Partial<
		Pick<
			BridgeAdapter,
			| "submitDeposit"
			| "finalizeDeposit"
			| "cancelDeposit"
			| "submitWithdrawal"
			| "finalizeWithdrawal"
			| "getDepositStatuses"
			| "getWithdrawalStatuses"
			| "canFinalizeDeposit"
			| "canCancelDeposit"
			| "canFinalizeWithdrawal"
			| "getStatusSources"
		>
	>
	sessionStore: Pick<SessionStore, "save">
	log: LogFn
	sleep: (ms: number) => Promise<void>
	pollIntervalMs: number
	retryDelayMs?: number
	now?: () => string
	verbose?: boolean
}

type BridgeFlowInput = {
	id: string
	from: ChainRef
	to: ChainRef
	amount: string
	account: string
	recipient?: string
	timeoutSlots?: number
	session?: OperationSession
}

type BridgeCommandDeps = {
	createAdapter?: BridgeAdapterFactory
	createStore?: (input: { stateDir: string }) => Pick<SessionStore, "save">
	createLogger?: (input: { logPath: string }) => Pick<
		ReturnType<typeof createOperationLogger>,
		"write"
	>
	now?: () => string
	resolvePaths?: typeof resolveAppPaths
	generateId?: () => string
	write?: (message: string) => void
	writeProgress?: (message: string) => void
	sleep?: (ms: number) => Promise<void>
	pollIntervalMs?: number
	retryDelayMs?: number
}

type BridgeCommandArgs = {
	from: { type: "string"; default: typeof DEFAULT_FROM_CHAIN }
	to: { type: "string"; default: typeof DEFAULT_TO_CHAIN }
	amount: { type: "string"; required: true }
	account: { type: "string"; required: false }
	recipient: { type: "string"; required: false }
	timeoutSlots: { type: "string"; required: false; alias: string[] }
	pollIntervalMs: { type: "string"; required: false; alias: string[] }
	retryDelayMs: { type: "string"; required: false; alias: string[] }
	json: { type: "boolean"; default: false }
	verbose: { type: "boolean"; default: false }
}

type TransitionEvent =
	| "MARK_SUBMITTED"
	| "MARK_WAITING_SUBMISSION"
	| "MARK_WAITING_PRIOR_CLAIMS"
	| "MARK_WAITING_FINALIZATION"
	| "MARK_RETRYING"
	| "MARK_FINALIZING"
	| "MARK_CANCELLING"
	| "MARK_COMPLETED"
	| "MARK_CANCELLED"
	| "MARK_FAILED"

type WaitStateTracker = {
	lastWaitSignature?: string
	lastHeartbeatBucket?: number
	emittedImmediateHeartbeat: boolean
}

const HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_FROM_CHAIN = MINA_NETWORKS.testnet
const DEFAULT_TO_CHAIN = ZEKO_M_NETWORKS.testnet

const OPERATION_STATE_BY_EVENT = {
	MARK_SUBMITTED: { phase: "submitted", status: "running" },
	MARK_WAITING_SUBMISSION: { phase: "waiting-submission", status: "running" },
	MARK_WAITING_PRIOR_CLAIMS: { phase: "waiting-prior-claims", status: "running" },
	MARK_WAITING_FINALIZATION: { phase: "waiting-finalization", status: "running" },
	MARK_RETRYING: { phase: "retrying", status: "running" },
	MARK_FINALIZING: { phase: "finalizing", status: "running" },
	MARK_CANCELLING: { phase: "canceling", status: "running" },
	MARK_COMPLETED: { phase: "completed", status: "completed" },
	MARK_CANCELLED: { phase: "cancelled", status: "cancelled" },
	MARK_FAILED: { phase: "failed", status: "failed" }
} satisfies Record<TransitionEvent, { phase: OperationPhase; status: OperationSession["status"] }>

const toPendingCancelMarker = ({
	currentTargetIndex,
	claimableIndex,
	pendingAhead,
	isCurrentTarget
}: {
	currentTargetIndex?: number
	claimableIndex?: number
	pendingAhead: number
	isCurrentTarget: boolean
}): string =>
	isCurrentTarget
		? `current:${currentTargetIndex ?? "none"}`
		: `prior:${claimableIndex ?? "none"}:${pendingAhead}`
const persistSession = async ({
	session,
	sessionStore,
	log,
	event,
	details
}: {
	session: OperationSession
	sessionStore: Pick<SessionStore, "save">
	log: LogFn
	event: string
	details?: Record<string, unknown>
}) => {
	await sessionStore.save(session)
	await log({ event, phase: session.phase, details })
}

const transitionSession = ({
	session,
	event,
	now,
	patch = {}
}: {
	session: OperationSession
	event: TransitionEvent
	now: () => string
	patch?: Partial<OperationSession>
}): OperationSession => {
	const next = OPERATION_STATE_BY_EVENT[event]
	const timestamp = now()
	return {
		...session,
		...patch,
		phase: next.phase,
		status: next.status,
		updatedAt: timestamp,
		verboseDiagnostics: session.verboseDiagnostics
			? withPhaseTiming({
					diagnostics: session.verboseDiagnostics,
					now: timestamp,
					nextPhase: next.phase
				})
			: undefined
	}
}

const deriveAccount = (from: ChainRef, explicit?: string): string => {
	if (explicit) return explicit

	const keys = resolveSignerKeys()
	const secret =
		from === ZEKO_M_NETWORKS.testnet || from === ZEKO_M_NETWORKS.mainnet ? keys.zeko : keys.mina
	return PrivateKey.fromBase58(secret).toPublicKey().toBase58()
}

const parseBridgeCommandArgs = (args: Record<string, unknown>) => ({
	from: parseChainRef(readOptionalStringArg(args, "from") ?? DEFAULT_FROM_CHAIN, "--from"),
	to: parseChainRef(readOptionalStringArg(args, "to") ?? DEFAULT_TO_CHAIN, "--to"),
	amount: readRequiredStringArg(args, "amount", "Missing required --amount"),
	account: readOptionalStringArg(args, "account"),
	recipient: readOptionalStringArg(args, "recipient"),
	timeoutSlots: readAliasedOptionalNumberArg(args, "timeoutSlots", "timeout-slots"),
	pollIntervalMs: readAliasedNumberArg(
		args,
		"pollIntervalMs",
		"poll-interval-ms",
		"--poll-interval-ms"
	),
	retryDelayMs: readAliasedNumberArg(args, "retryDelayMs", "retry-delay-ms", "--retry-delay-ms"),
	json: readBooleanArg(args, "json"),
	verbose: readBooleanArg(args, "verbose")
})

const requireAdapterMethod = <T extends keyof BridgeFlowDeps["adapter"]>(
	adapter: BridgeFlowDeps["adapter"],
	method: T
): NonNullable<BridgeFlowDeps["adapter"][T]> => {
	const value = adapter[method]
	if (!value) {
		throw new Error(`Adapter does not implement ${String(method)}`)
	}

	return value
}

const getCapabilityDiagnostic = async ({
	adapter,
	account,
	method
}: {
	adapter: BridgeFlowDeps["adapter"]
	account: string
	method: "canFinalizeDeposit" | "canCancelDeposit" | "canFinalizeWithdrawal"
}): Promise<BridgeCapabilityDiagnostic> => {
	const result = adapter[method] ? await adapter[method](account) : false
	return typeof result === "boolean" ? { available: result, reason: null } : result
}

const appendSubmittedTransaction = (
	session: OperationSession,
	transaction: { action: "submit" | "finalize" | "cancel"; hash: string }
) => ({
	submittedTransactions: [...session.submittedTransactions, transaction]
})

const getElapsedSeconds = (session: OperationSession, now: () => string): number => {
	const startedAt = Date.parse(session.createdAt)
	const currentTime = Date.parse(now())
	if (Number.isNaN(startedAt) || Number.isNaN(currentTime)) return 0
	return Math.max(0, Math.floor((currentTime - startedAt) / 1000))
}

const getHeartbeatBucket = ({
	elapsedSeconds,
	pollIntervalMs
}: {
	elapsedSeconds: number
	pollIntervalMs: number
}): number => {
	const intervalMs = Math.max(
		pollIntervalMs > 0 ? pollIntervalMs : HEARTBEAT_INTERVAL_MS,
		HEARTBEAT_INTERVAL_MS
	)
	return Math.floor((elapsedSeconds * 1_000) / intervalMs)
}

const formatErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

const TRANSIENT_CLAIM_UNAVAILABLE_ERROR_PATTERNS = [
	/Did not find any (deposit|withdrawal) to finalize/i,
	/No (deposit|withdrawal) witnesses found/i,
	/No earliest before state found/i,
	/No my (deposit|withdrawal) index found/i,
	/No next commit index found/i,
	/No synced outer action state index found/i
]

const isTransientClaimUnavailableError = (error: unknown): boolean => {
	const message = formatErrorMessage(error)
	return TRANSIENT_CLAIM_UNAVAILABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

const isRetryableCapabilityError = (error: unknown): boolean =>
	!isInsufficientFirstWithdrawalAmountError(error)

const isRetryableInitializationError = (error: unknown): boolean => {
	const message = formatErrorMessage(error)
	return !/Missing required signer private key|Unsupported bridge route|Invalid private key/i.test(
		message
	)
}

const isOperationSession = (value: unknown): value is OperationSession =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { id?: unknown }).id === "string" &&
	typeof (value as { status?: unknown }).status === "string" &&
	typeof (value as { phase?: unknown }).phase === "string"

const getRecordedSessionFromError = (error: unknown): OperationSession | undefined =>
	typeof error === "object" &&
	error !== null &&
	"session" in error &&
	isOperationSession(error.session)
		? (error.session as OperationSession)
		: undefined

const maybeEmitHeartbeat = async ({
	session,
	now,
	pollIntervalMs,
	tracker,
	log,
	details
}: {
	session: OperationSession
	now: () => string
	pollIntervalMs: number
	tracker: WaitStateTracker
	log: LogFn
	details: Record<string, unknown>
}) => {
	if (pollIntervalMs === 0) {
		if (!tracker.emittedImmediateHeartbeat) {
			tracker.emittedImmediateHeartbeat = true
			await log({
				event: "heartbeat",
				phase: session.phase,
				details: { elapsedSeconds: getElapsedSeconds(session, now), ...details }
			})
		}
		return
	}

	const elapsedSeconds = getElapsedSeconds(session, now)
	const bucket = getHeartbeatBucket({ elapsedSeconds, pollIntervalMs })
	if (bucket <= 0 || bucket === tracker.lastHeartbeatBucket) {
		return
	}

	tracker.lastHeartbeatBucket = bucket
	await log({
		event: "heartbeat",
		phase: session.phase,
		details: { elapsedSeconds, ...details }
	})
}

const maybeEnterWaitState = async ({
	session,
	sessionStore,
	log,
	now,
	tracker,
	signature,
	event,
	phaseEvent,
	patch,
	details
}: {
	session: OperationSession
	sessionStore: Pick<SessionStore, "save">
	log: LogFn
	now: () => string
	tracker: WaitStateTracker
	signature: string
	event: string
	phaseEvent: TransitionEvent
	patch?: Partial<OperationSession>
	details?: Record<string, unknown>
}): Promise<OperationSession> => {
	const nextSession =
		tracker.lastWaitSignature === signature
			? {
					...session,
					...patch,
					updatedAt: now()
				}
			: transitionSession({
					session,
					event: phaseEvent,
					now,
					patch
				})

	if (tracker.lastWaitSignature !== signature) {
		tracker.lastWaitSignature = signature
		tracker.emittedImmediateHeartbeat = false
		await persistSession({
			session: nextSession,
			sessionStore,
			log,
			event,
			details
		})
	}

	return nextSession
}

const enterDecisionWaitState = async ({
	session,
	decision,
	sessionStore,
	log,
	now,
	tracker,
	patch
}: {
	session: OperationSession
	decision: BridgeRuntimeDecision
	sessionStore: Pick<SessionStore, "save">
	log: LogFn
	now: () => string
	tracker: WaitStateTracker
	patch?: Partial<OperationSession>
}): Promise<OperationSession> => {
	if (!decision.waitSignature || !decision.waitEvent || !decision.phaseEvent) {
		return session
	}

	return maybeEnterWaitState({
		session,
		sessionStore,
		log,
		now,
		tracker,
		signature: decision.waitSignature,
		event: decision.waitEvent,
		phaseEvent: decision.phaseEvent,
		patch,
		details: decision.details
	})
}

const withRetry = async <T>({
	session,
	sessionStore,
	log,
	sleep,
	retryDelayMs,
	now,
	operation,
	shouldRetry,
	run
}: {
	session: OperationSession
	sessionStore: Pick<SessionStore, "save">
	log: LogFn
	sleep: (ms: number) => Promise<void>
	retryDelayMs?: number
	now: () => string
	operation: BridgeSdkOperation
	shouldRetry?: (error: unknown) => boolean
	run: () => Promise<T>
}): Promise<{ session: OperationSession; value: T }> => {
	let currentSession = session

	try {
		const value = await retryWithBackoff({
			operation,
			baseDelayMs: retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
			maxRetries: DEFAULT_MAX_RETRIES,
			sleep,
			shouldRetry: shouldRetry ?? (() => true),
			run: async (attempt) => {
				const { session: nextSession, value } = await createInstrumentedBridgeAdapter({
					adapter: {},
					session: currentSession
				}).call(operation, run, { attempt })
				currentSession = nextSession
				return value
			},
			onRetry: async ({ error, retryIndex, delayMs }) => {
				currentSession = getRecordedSessionFromError(error) ?? currentSession
				currentSession = transitionSession({
					session: currentSession,
					event: "MARK_RETRYING",
					now,
					patch: {
						lastError: formatErrorMessage(error)
					}
				})
				await persistSession({
					session: currentSession,
					sessionStore,
					log,
					event: "retrying",
					details: {
						operation,
						attempt: retryIndex,
						nextDelayMs: delayMs,
						message: formatErrorMessage(error)
					}
				})
			}
		})

		return { session: currentSession, value }
	} catch (error) {
		currentSession =
			getRecordedSessionFromError(error) ??
			(typeof error === "object" && error !== null && "cause" in error
				? getRecordedSessionFromError(error.cause)
				: undefined) ??
			currentSession
		if (error instanceof Error && !("session" in error)) {
			Object.assign(error, { session: currentSession })
		}
		throw error
	}
}

const completeSession = async ({
	session,
	sessionStore,
	log,
	now,
	finalTransaction
}: {
	session: OperationSession
	sessionStore: Pick<SessionStore, "save">
	log: LogFn
	now: () => string
	finalTransaction?: OperationSession["finalTransaction"]
}) => {
	const completed = transitionSession({
		session,
		event: "MARK_COMPLETED",
		now,
		patch: finalTransaction ? { finalTransaction } : {}
	})
	await persistSession({
		session: completed,
		sessionStore,
		log,
		event: "completed",
		details: { hash: completed.finalTransaction?.hash }
	})
	return completed
}

const cancelSession = async ({
	session,
	sessionStore,
	log,
	now
}: {
	session: OperationSession
	sessionStore: Pick<SessionStore, "save">
	log: LogFn
	now: () => string
}) => {
	const cancelled = transitionSession({
		session,
		event: "MARK_CANCELLED",
		now
	})
	await persistSession({
		session: cancelled,
		sessionStore,
		log,
		event: "cancelled"
	})
	return cancelled
}

const failSession = async ({
	session,
	sessionStore,
	log,
	now,
	error
}: {
	session: OperationSession
	sessionStore: Pick<SessionStore, "save">
	log: LogFn
	now: () => string
	error: string
}) => {
	const failed = transitionSession({
		session,
		event: "MARK_FAILED",
		now,
		patch: {
			lastError: error
		}
	})
	await persistSession({
		session: failed,
		sessionStore,
		log,
		event: "failed",
		details: { message: error }
	})
	return failed
}

type BridgeRunnerContext = {
	session: OperationSession
	input: BridgeFlowInput
	deps: BridgeFlowDeps
	waitTracker: WaitStateTracker
	now: () => string
	depositAnalysis?: DepositQueueState
	withdrawalAnalysis?: WithdrawalQueueState
}

type RunnerStep =
	| "submit-deposit"
	| "submit-withdrawal"
	| "inspect-deposit"
	| "inspect-withdrawal"
	| "wait-deposit"
	| "wait-withdrawal"
	| "finalize-deposit"
	| "cancel-deposit"
	| "finalize-withdrawal"
	| "completed"
	| "cancelled"
	| "failed"

type RunnerOutput = Pick<
	BridgeRunnerContext,
	"session" | "depositAnalysis" | "withdrawalAnalysis"
> & {
	next: RunnerStep
}

const createInitialRunnerContext = (
	input: BridgeFlowInput,
	deps: BridgeFlowDeps
): BridgeRunnerContext => {
	const route = resolveRoute(input.from, input.to)
	const now = deps.now ?? (() => new Date().toISOString())
	const createdAt = now()
	const baseSession =
		input.session ??
		({
			id: input.id,
			status: "running",
			phase: "initializing",
			route: formatRoute(input.from, input.to),
			direction: route.direction,
			account: input.account,
			recipient: input.recipient ?? input.account,
			amount: input.amount,
			timeoutSlots: input.timeoutSlots,
			logPath: "",
			createdAt,
			updatedAt: createdAt,
			submittedTransactions: [],
			verboseDiagnostics: deps.verbose
				? createVerboseDiagnostics(createdAt, "initializing")
				: undefined
		} satisfies OperationSession)
	const session =
		deps.verbose && !baseSession.verboseDiagnostics
			? {
					...baseSession,
					verboseDiagnostics: createVerboseDiagnostics(baseSession.createdAt, baseSession.phase)
				}
			: baseSession

	return {
		session,
		input,
		deps,
		now,
		waitTracker: {
			emittedImmediateHeartbeat: false
		}
	}
}

const runSubmitStep = async (
	context: BridgeRunnerContext,
	direction: "deposit" | "withdrawal"
): Promise<RunnerOutput> => {
	const { deps, now } = context
	let { session } = context

	try {
		const submitResult =
			direction === "deposit"
				? await withRetry({
						session,
						sessionStore: deps.sessionStore,
						log: deps.log,
						sleep: deps.sleep,
						retryDelayMs: deps.retryDelayMs,
						now,
						operation: "submitDeposit",
						shouldRetry: isRecoverableMutationError,
						run: async () =>
							requireAdapterMethod(
								deps.adapter,
								"submitDeposit"
							)({
								account: session.account,
								recipient: session.recipient,
								amount: session.amount,
								timeoutSlots: session.timeoutSlots,
								wait: false
							})
					})
				: await withRetry({
						session,
						sessionStore: deps.sessionStore,
						log: deps.log,
						sleep: deps.sleep,
						retryDelayMs: deps.retryDelayMs,
						now,
						operation: "submitWithdrawal",
						shouldRetry: isRecoverableMutationError,
						run: async () =>
							requireAdapterMethod(
								deps.adapter,
								"submitWithdrawal"
							)({
								account: session.account,
								recipient: session.recipient,
								amount: session.amount,
								wait: false
							})
					})

		session = submitResult.session
		session = transitionSession({
			session,
			event: "MARK_SUBMITTED",
			now,
			patch: appendSubmittedTransaction(session, {
				action: "submit",
				hash: submitResult.value.hash
			})
		})
		await persistSession({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			event: "submitted",
			details: { hash: submitResult.value.hash }
		})

		return {
			session,
			next: direction === "deposit" ? "inspect-deposit" : "inspect-withdrawal"
		}
	} catch (error) {
		return {
			session: await failSession({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				now,
				error: formatErrorMessage(error)
			}),
			next: "failed"
		}
	}
}

const runInspectDepositStep = async (context: BridgeRunnerContext): Promise<RunnerOutput> => {
	const { deps, waitTracker, now } = context
	let { session } = context

	try {
		const depositStatusesResult = await withRetry({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			sleep: deps.sleep,
			retryDelayMs: deps.retryDelayMs,
			now,
			operation: "getDepositStatuses",
			run: async () => requireAdapterMethod(deps.adapter, "getDepositStatuses")(session.account)
		})
		session = depositStatusesResult.session
		const hasSubmittedDeposit = getSubmitHash(session) !== undefined
		const sortedStatuses = sortByIndex(depositStatusesResult.value)
		const initialDecision = decideDepositStep({
			session,
			statuses: sortedStatuses,
			canFinalize: { available: false, reason: null },
			canCancel: { available: false, reason: null },
			now
		})
		const analysis = initialDecision.analysis as DepositQueueState
		const { target, targetIndex } = analysis

		if (hasSubmittedDeposit && targetIndex !== undefined && session.targetIndex !== targetIndex) {
			session = {
				...session,
				targetIndex,
				updatedAt: now()
			}
			await deps.sessionStore.save(session)
		}

		if (initialDecision.action === "submit") {
			return {
				session: {
					...session,
					targetIndex: undefined,
					pendingFinalizeIndex: undefined,
					pendingFinalizeSubmittedAt: undefined,
					pendingCancelMarker: undefined,
					updatedAt: now()
				},
				depositAnalysis: analysis,
				next: "submit-deposit"
			}
		}

		if (initialDecision.action === "cancelled") {
			return {
				session: await cancelSession({
					session,
					sessionStore: deps.sessionStore,
					log: deps.log,
					now
				}),
				depositAnalysis: analysis,
				next: "cancelled"
			}
		}

		if (initialDecision.action === "complete") {
			if (!target) {
				throw new Error("Completed deposit decision did not include a target deposit.")
			}
			return {
				session: await completeSession({
					session,
					sessionStore: deps.sessionStore,
					log: deps.log,
					now,
					finalTransaction: session.finalTransaction ?? {
						action: "finalize",
						hash: target.hash,
						explorerUrl: ""
					}
				}),
				depositAnalysis: analysis,
				next: "completed"
			}
		}

		session = await enterDecisionWaitState({
			session,
			decision: initialDecision,
			sessionStore: deps.sessionStore,
			log: deps.log,
			now,
			tracker: waitTracker,
			patch:
				initialDecision.phaseEvent === "MARK_WAITING_PRIOR_CLAIMS"
					? {
							targetIndex: hasSubmittedDeposit ? analysis.targetIndex : undefined,
							queueAdvances: session.queueAdvances ?? 0
						}
					: initialDecision.phaseEvent === "MARK_WAITING_FINALIZATION"
						? {
								targetIndex: hasSubmittedDeposit ? analysis.target?.index : undefined
							}
						: undefined
		})

		const [canFinalizeDepositResult, canCancelResult] = await Promise.all([
			withRetry({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				sleep: deps.sleep,
				retryDelayMs: deps.retryDelayMs,
				now,
				operation: "canFinalizeDeposit",
				run: async () =>
					getCapabilityDiagnostic({
						adapter: deps.adapter,
						account: session.account,
						method: "canFinalizeDeposit"
					})
			}),
			withRetry({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				sleep: deps.sleep,
				retryDelayMs: deps.retryDelayMs,
				now,
				operation: "canCancelDeposit",
				run: async () =>
					getCapabilityDiagnostic({
						adapter: deps.adapter,
						account: session.account,
						method: "canCancelDeposit"
					})
			})
		])
		session = mergeVerboseDiagnosticsFromSessions({
			session,
			sources: [canFinalizeDepositResult.session, canCancelResult.session]
		})
		session = withCapabilityWaitReason({
			session,
			key: "canFinalizeDeposit",
			diagnostic: canFinalizeDepositResult.value
		})
		session = withCapabilityWaitReason({
			session,
			key: "canCancelDeposit",
			diagnostic: canCancelResult.value
		})
		const decision = decideDepositStep({
			session,
			statuses: sortedStatuses,
			canFinalize: canFinalizeDepositResult.value,
			canCancel: canCancelResult.value,
			now
		})
		const nextAnalysis = decision.analysis as DepositQueueState
		const {
			target: nextTarget,
			targetIndex: nextTargetIndex,
			claimableIndex,
			pendingAhead,
			blockingAhead,
			skippableAhead,
			shouldAdvanceQueuedClaims
		} = nextAnalysis
		const effectiveClaimableIndex = resolveEffectiveDepositClaimableIndex({
			claimableIndex: canFinalizeDepositResult.value.index ?? claimableIndex,
			target: nextTarget,
			pendingAhead,
			canFinalize: canFinalizeDepositResult.value.available
		})
		if (decision.action === "finalize") {
			return {
				session,
				depositAnalysis: nextAnalysis,
				next: "finalize-deposit"
			}
		}

		if (decision.action === "cancel") {
			return {
				session,
				depositAnalysis: nextAnalysis,
				next: "cancel-deposit"
			}
		}

		await maybeEmitHeartbeat({
			session,
			now,
			pollIntervalMs: deps.pollIntervalMs,
			tracker: waitTracker,
			log: deps.log,
			details: shouldAdvanceQueuedClaims
				? {
						waiting: "prior-claims",
						pendingAhead,
						blockingAhead,
						skippableAhead,
						targetIndex: nextTargetIndex,
						claimIndex: effectiveClaimableIndex,
						finalizeAvailable: canFinalizeDepositResult.value.available,
						finalizeReason: canFinalizeDepositResult.value.reason,
						cancelAvailable: canCancelResult.value.available,
						cancelReason: canCancelResult.value.reason
					}
				: nextTarget
					? {
							waiting: "finalization",
							targetIndex: nextTarget.index,
							claimIndex: effectiveClaimableIndex,
							finalizeAvailable: canFinalizeDepositResult.value.available,
							finalizeReason: canFinalizeDepositResult.value.reason,
							cancelAvailable: canCancelResult.value.available,
							cancelReason: canCancelResult.value.reason
						}
					: {
							waiting: "submission",
							submitHash: getSubmitHash(session),
							finalizeAvailable: canFinalizeDepositResult.value.available,
							finalizeReason: canFinalizeDepositResult.value.reason,
							cancelAvailable: canCancelResult.value.available,
							cancelReason: canCancelResult.value.reason
						}
		})

		return {
			session,
			depositAnalysis: nextAnalysis,
			next: "wait-deposit"
		}
	} catch (error) {
		return {
			session: await failSession({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				now,
				error: formatErrorMessage(error)
			}),
			next: "failed"
		}
	}
}

const runInspectWithdrawalStep = async (context: BridgeRunnerContext): Promise<RunnerOutput> => {
	const { deps, waitTracker, now } = context
	let { session } = context

	try {
		const withdrawalStatusesResult = await withRetry({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			sleep: deps.sleep,
			retryDelayMs: deps.retryDelayMs,
			now,
			operation: "getWithdrawalStatuses",
			run: async () => requireAdapterMethod(deps.adapter, "getWithdrawalStatuses")(session.account)
		})
		session = withdrawalStatusesResult.session
		const sortedStatuses = sortByIndex(withdrawalStatusesResult.value)
		const withdrawalStatusSourceDetails = toWithdrawalStatusSourceLogDetails(
			getWithdrawalStatusSourceSnapshot({
				adapter: deps.adapter,
				statuses: sortedStatuses,
				submitHash: getSubmitHash(session)
			})
		)
		const initialDecision = decideWithdrawalStep({
			session,
			statuses: sortedStatuses,
			canFinalize: { available: false, reason: null },
			now
		})
		const analysis = initialDecision.analysis as WithdrawalQueueState
		const { target, targetIndex } = analysis

		if (targetIndex !== undefined && session.targetIndex !== targetIndex) {
			session = {
				...session,
				targetIndex,
				updatedAt: now()
			}
			await deps.sessionStore.save(session)
		}

		if (initialDecision.action === "submit") {
			return {
				session: {
					...session,
					targetIndex: undefined,
					pendingFinalizeIndex: undefined,
					pendingFinalizeSubmittedAt: undefined,
					updatedAt: now()
				},
				withdrawalAnalysis: analysis,
				next: "submit-withdrawal"
			}
		}

		if (initialDecision.action === "complete") {
			if (!target) {
				throw new Error("Completed withdrawal decision did not include a target withdrawal.")
			}
			return {
				session: await completeSession({
					session,
					sessionStore: deps.sessionStore,
					log: deps.log,
					now,
					finalTransaction: session.finalTransaction ?? {
						action: "finalize",
						hash: target.hash,
						explorerUrl: ""
					}
				}),
				withdrawalAnalysis: analysis,
				next: "completed"
			}
		}

		session = await enterDecisionWaitState({
			session,
			decision: {
				...initialDecision,
				details: { ...initialDecision.details, ...withdrawalStatusSourceDetails }
			},
			sessionStore: deps.sessionStore,
			log: deps.log,
			now,
			tracker: waitTracker,
			patch:
				initialDecision.phaseEvent === "MARK_WAITING_PRIOR_CLAIMS"
					? {
							targetIndex,
							queueAdvances: session.queueAdvances ?? 0
						}
					: initialDecision.phaseEvent === "MARK_WAITING_FINALIZATION" && target
						? { targetIndex: target.index }
						: undefined
		})

		if (
			initialDecision.action === "wait" &&
			initialDecision.phaseEvent === "MARK_WAITING_SUBMISSION" &&
			target &&
			!target.committed
		) {
			await maybeEmitHeartbeat({
				session,
				now,
				pollIntervalMs: deps.pollIntervalMs,
				tracker: waitTracker,
				log: deps.log,
				details: {
					waiting: "submission",
					targetIndex: target.index,
					submitHash: getSubmitHash(session),
					...withdrawalStatusSourceDetails
				}
			})

			return {
				session,
				withdrawalAnalysis: analysis,
				next: "wait-withdrawal"
			}
		}

		const canFinalizeResult = await withRetry({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			sleep: deps.sleep,
			retryDelayMs: deps.retryDelayMs,
			now,
			operation: "canFinalizeWithdrawal",
			shouldRetry: isRetryableCapabilityError,
			run: async () =>
				getCapabilityDiagnostic({
					adapter: deps.adapter,
					account: session.account,
					method: "canFinalizeWithdrawal"
				})
		})
		session = canFinalizeResult.session
		session = withCapabilityWaitReason({
			session,
			key: "canFinalizeWithdrawal",
			diagnostic: canFinalizeResult.value
		})
		const decision = decideWithdrawalStep({
			session,
			statuses: sortedStatuses,
			canFinalize: canFinalizeResult.value,
			now
		})
		const nextAnalysis = decision.analysis as WithdrawalQueueState
		const {
			target: nextTarget,
			targetIndex: nextTargetIndex,
			claimableIndex,
			pendingAhead,
			shouldAdvanceQueuedClaims
		} = nextAnalysis

		if (decision.action === "complete") {
			return {
				session: await completeSession({
					session,
					sessionStore: deps.sessionStore,
					log: deps.log,
					now,
					finalTransaction: session.finalTransaction ?? {
						action: "finalize",
						hash: nextTarget?.hash ?? getSubmitHash(session) ?? "",
						explorerUrl: ""
					}
				}),
				withdrawalAnalysis: nextAnalysis,
				next: "completed"
			}
		}

		if (decision.action === "finalize") {
			return {
				session,
				withdrawalAnalysis: nextAnalysis,
				next: "finalize-withdrawal"
			}
		}

		await maybeEmitHeartbeat({
			session,
			now,
			pollIntervalMs: deps.pollIntervalMs,
			tracker: waitTracker,
			log: deps.log,
			details: shouldAdvanceQueuedClaims
				? {
						waiting: "prior-claims",
						pendingAhead,
						targetIndex: nextTargetIndex,
						claimIndex: claimableIndex,
						finalizeAvailable: canFinalizeResult.value.available,
						finalizeReason: canFinalizeResult.value.reason,
						...withdrawalStatusSourceDetails
					}
				: nextTarget
					? {
							waiting: "finalization",
							targetIndex: nextTarget.index,
							claimIndex: claimableIndex,
							finalizeAvailable: canFinalizeResult.value.available,
							finalizeReason: canFinalizeResult.value.reason,
							...withdrawalStatusSourceDetails
						}
					: {
							waiting: "submission",
							submitHash: getSubmitHash(session),
							finalizeAvailable: canFinalizeResult.value.available,
							finalizeReason: canFinalizeResult.value.reason,
							...withdrawalStatusSourceDetails
						}
		})

		return {
			session,
			withdrawalAnalysis: nextAnalysis,
			next: "wait-withdrawal"
		}
	} catch (error) {
		return {
			session: await failSession({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				now,
				error: formatErrorMessage(error)
			}),
			next: "failed"
		}
	}
}

const runFinalizeDepositStep = async (context: BridgeRunnerContext): Promise<RunnerOutput> => {
	const { deps, waitTracker, now, depositAnalysis } = context
	let { session } = context

	if (!depositAnalysis) {
		return {
			session: await failSession({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				now,
				error: "Missing deposit queue analysis before finalize."
			}),
			next: "failed"
		}
	}

	const effectiveClaimableIndex =
		depositAnalysis.effectiveClaimableIndex ??
		resolveEffectiveDepositClaimableIndex({
			claimableIndex: depositAnalysis.claimableIndex,
			target: depositAnalysis.target,
			pendingAhead: depositAnalysis.pendingAhead,
			canFinalize: true
		})
	try {
		const finalizeDepositResult = await withRetry({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			sleep: deps.sleep,
			retryDelayMs: deps.retryDelayMs,
			now,
			operation: "finalizeDeposit",
			shouldRetry: isRecoverableMutationError,
			run: async () =>
				requireAdapterMethod(
					deps.adapter,
					"finalizeDeposit"
				)({
					account: session.account,
					wait: false
				})
		})
		session = finalizeDepositResult.session
		const finalizeResult = finalizeDepositResult.value
		session = transitionSession({
			session,
			event: "MARK_FINALIZING",
			now,
			patch: {
				...appendSubmittedTransaction(session, {
					action: "finalize",
					hash: finalizeResult.hash
				}),
				finalTransaction:
					depositAnalysis.target && effectiveClaimableIndex === depositAnalysis.target.index
						? {
								action: "finalize",
								hash: finalizeResult.hash,
								explorerUrl: finalizeResult.explorerUrl
							}
						: session.finalTransaction,
				pendingFinalizeIndex: effectiveClaimableIndex,
				pendingFinalizeSubmittedAt: now(),
				queueAdvances: depositAnalysis.shouldAdvanceQueuedClaims
					? (session.queueAdvances ?? 0) + 1
					: session.queueAdvances
			}
		})
		waitTracker.lastWaitSignature = undefined
		waitTracker.emittedImmediateHeartbeat = false
		await persistSession({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			event: "finalized",
			details: {
				hash: finalizeResult.hash,
				claimIndex: effectiveClaimableIndex,
				advancedPriorClaim: depositAnalysis.shouldAdvanceQueuedClaims
			}
		})

		return {
			session,
			next: "wait-deposit"
		}
	} catch (error) {
		if (!isTransientClaimUnavailableError(error)) {
			return {
				session: await failSession({
					session,
					sessionStore: deps.sessionStore,
					log: deps.log,
					now,
					error: formatErrorMessage(error)
				}),
				next: "failed"
			}
		}

		await deps.log({
			event: "claim-pending",
			phase: session.phase,
			details: {
				claimIndex: effectiveClaimableIndex,
				message: formatErrorMessage(error)
			}
		})

		return {
			session,
			next: "wait-deposit"
		}
	}
}

const runCancelDepositStep = async (context: BridgeRunnerContext): Promise<RunnerOutput> => {
	const { deps, waitTracker, now, depositAnalysis } = context
	let { session } = context

	if (!depositAnalysis) {
		return {
			session: await failSession({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				now,
				error: "Missing deposit queue analysis before cancel."
			}),
			next: "failed"
		}
	}

	try {
		const cancelDepositResult = await withRetry({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			sleep: deps.sleep,
			retryDelayMs: deps.retryDelayMs,
			now,
			operation: "cancelDeposit",
			shouldRetry: isRecoverableMutationError,
			run: async () =>
				requireAdapterMethod(
					deps.adapter,
					"cancelDeposit"
				)({
					account: session.account,
					wait: false
				})
		})
		session = cancelDepositResult.session
		const cancelResult = cancelDepositResult.value
		const hasSubmittedDeposit = getSubmitHash(session) !== undefined
		const cancellingCurrentTarget =
			hasSubmittedDeposit &&
			depositAnalysis.target !== undefined &&
			depositAnalysis.pendingAhead === 0 &&
			(depositAnalysis.claimableIndex === undefined ||
				depositAnalysis.claimableIndex === depositAnalysis.target.index)
		const pendingCancelMarker = toPendingCancelMarker({
			currentTargetIndex: depositAnalysis.target?.index,
			claimableIndex: depositAnalysis.claimableIndex,
			pendingAhead: depositAnalysis.pendingAhead,
			isCurrentTarget: cancellingCurrentTarget
		})
		session = transitionSession({
			session,
			event: "MARK_CANCELLING",
			now,
			patch: {
				...appendSubmittedTransaction(session, {
					action: "cancel",
					hash: cancelResult.hash
				}),
				finalTransaction: cancellingCurrentTarget
					? {
							action: "cancel",
							hash: cancelResult.hash,
							explorerUrl: cancelResult.explorerUrl
						}
					: session.finalTransaction,
				pendingCancelMarker,
				queueAdvances: depositAnalysis.shouldAdvanceQueuedClaims
					? (session.queueAdvances ?? 0) + 1
					: session.queueAdvances
			}
		})
		waitTracker.lastWaitSignature = undefined
		waitTracker.emittedImmediateHeartbeat = false
		await persistSession({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			event: "cancel-submitted",
			details: {
				hash: cancelResult.hash,
				advancedPriorClaim: depositAnalysis.shouldAdvanceQueuedClaims,
				pendingAhead: depositAnalysis.pendingAhead,
				claimIndex: depositAnalysis.claimableIndex
			}
		})

		return {
			session,
			next: "wait-deposit"
		}
	} catch (error) {
		return {
			session: await failSession({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				now,
				error: formatErrorMessage(error)
			}),
			next: "failed"
		}
	}
}

const runFinalizeWithdrawalStep = async (context: BridgeRunnerContext): Promise<RunnerOutput> => {
	const { deps, waitTracker, now, withdrawalAnalysis } = context
	let { session } = context

	if (!withdrawalAnalysis) {
		return {
			session: await failSession({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				now,
				error: "Missing withdrawal queue analysis before finalize."
			}),
			next: "failed"
		}
	}

	try {
		const finalizeWithdrawalResult = await withRetry({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			sleep: deps.sleep,
			retryDelayMs: deps.retryDelayMs,
			now,
			operation: "finalizeWithdrawal",
			shouldRetry: isRecoverableMutationError,
			run: async () =>
				requireAdapterMethod(
					deps.adapter,
					"finalizeWithdrawal"
				)({
					account: session.account,
					wait: false
				})
		})
		session = finalizeWithdrawalResult.session
		const finalizeResult = finalizeWithdrawalResult.value
		session = transitionSession({
			session,
			event: "MARK_FINALIZING",
			now,
			patch: {
				...appendSubmittedTransaction(session, {
					action: "finalize",
					hash: finalizeResult.hash
				}),
				finalTransaction:
					withdrawalAnalysis.target &&
					withdrawalAnalysis.claimableIndex === withdrawalAnalysis.target.index
						? {
								action: "finalize",
								hash: finalizeResult.hash,
								explorerUrl: finalizeResult.explorerUrl
							}
						: session.finalTransaction,
				pendingFinalizeIndex: withdrawalAnalysis.claimableIndex,
				pendingFinalizeSubmittedAt: now(),
				queueAdvances: withdrawalAnalysis.shouldAdvanceQueuedClaims
					? (session.queueAdvances ?? 0) + 1
					: session.queueAdvances
			}
		})
		waitTracker.lastWaitSignature = undefined
		waitTracker.emittedImmediateHeartbeat = false
		await persistSession({
			session,
			sessionStore: deps.sessionStore,
			log: deps.log,
			event: "finalized",
			details: {
				hash: finalizeResult.hash,
				claimIndex: withdrawalAnalysis.claimableIndex,
				advancedPriorClaim: withdrawalAnalysis.shouldAdvanceQueuedClaims
			}
		})

		return {
			session,
			next: "wait-withdrawal"
		}
	} catch (error) {
		if (!isTransientClaimUnavailableError(error)) {
			return {
				session: await failSession({
					session,
					sessionStore: deps.sessionStore,
					log: deps.log,
					now,
					error: formatErrorMessage(error)
				}),
				next: "failed"
			}
		}

		await deps.log({
			event: "claim-pending",
			phase: session.phase,
			details: {
				claimIndex: withdrawalAnalysis.claimableIndex,
				message: formatErrorMessage(error)
			}
		})

		return {
			session,
			next: "wait-withdrawal"
		}
	}
}

const runWaitStep = async (
	context: BridgeRunnerContext,
	direction: "deposit" | "withdrawal"
): Promise<RunnerOutput> => {
	const { deps, now } = context
	const { session } = context

	try {
		await deps.sleep(deps.pollIntervalMs)
		return {
			session,
			depositAnalysis: context.depositAnalysis,
			withdrawalAnalysis: context.withdrawalAnalysis,
			next: direction === "deposit" ? "inspect-deposit" : "inspect-withdrawal"
		}
	} catch (error) {
		return {
			session: await failSession({
				session,
				sessionStore: deps.sessionStore,
				log: deps.log,
				now,
				error: formatErrorMessage(error)
			}),
			depositAnalysis: context.depositAnalysis,
			withdrawalAnalysis: context.withdrawalAnalysis,
			next: "failed"
		}
	}
}

const getDoneOutput = (event: unknown): RunnerOutput => (event as { output: RunnerOutput }).output

const routeDepositWait = [
	{
		target: "waitingDepositSubmission",
		guard: "isWaitingDepositSubmission",
		actions: "applyRunnerOutput"
	},
	{
		target: "waitingDepositPriorClaims",
		guard: "isWaitingDepositPriorClaims",
		actions: "applyRunnerOutput"
	},
	{
		target: "waitingDepositFinalization",
		guard: "isWaitingDepositFinalization",
		actions: "applyRunnerOutput"
	}
] as const

const routeWithdrawalWait = [
	{
		target: "waitingWithdrawalSubmission",
		guard: "isWaitingWithdrawalSubmission",
		actions: "applyRunnerOutput"
	},
	{
		target: "waitingWithdrawalPriorClaims",
		guard: "isWaitingWithdrawalPriorClaims",
		actions: "applyRunnerOutput"
	},
	{
		target: "waitingWithdrawalFinalization",
		guard: "isWaitingWithdrawalFinalization",
		actions: "applyRunnerOutput"
	}
] as const

const terminalRoutes = [
	{
		target: "completed",
		guard: "isCompleted",
		actions: "applyRunnerOutput"
	},
	{
		target: "cancelled",
		guard: "isCancelled",
		actions: "applyRunnerOutput"
	},
	{
		target: "failed",
		guard: "isFailed",
		actions: "applyRunnerOutput"
	}
] as const

const actorInput = ({ context }: { context: BridgeRunnerContext }) => context

export const bridgeOperationMachine: AnyStateMachine = setup({
	types: {
		context: {} as BridgeRunnerContext,
		input: {} as BridgeRunnerContext,
		output: {} as OperationSession
	},
	actors: {
		submitDeposit: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runSubmitStep(input, "deposit")
		),
		submitWithdrawal: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runSubmitStep(input, "withdrawal")
		),
		inspectDeposit: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runInspectDepositStep(input)
		),
		inspectWithdrawal: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runInspectWithdrawalStep(input)
		),
		waitDeposit: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runWaitStep(input, "deposit")
		),
		waitWithdrawal: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runWaitStep(input, "withdrawal")
		),
		finalizeDeposit: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runFinalizeDepositStep(input)
		),
		cancelDeposit: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runCancelDepositStep(input)
		),
		finalizeWithdrawal: fromPromise<RunnerOutput, BridgeRunnerContext>(({ input }) =>
			runFinalizeWithdrawalStep(input)
		)
	},
	actions: {
		applyRunnerOutput: assign({
			session: ({ event }) => getDoneOutput(event).session,
			depositAnalysis: ({ context, event }) =>
				getDoneOutput(event).depositAnalysis ?? context.depositAnalysis,
			withdrawalAnalysis: ({ context, event }) =>
				getDoneOutput(event).withdrawalAnalysis ?? context.withdrawalAnalysis
		})
	},
	guards: {
		isCompleted: ({ event }) => getDoneOutput(event).next === "completed",
		isCancelled: ({ event }) => getDoneOutput(event).next === "cancelled",
		isFailed: ({ event }) => getDoneOutput(event).next === "failed",
		isSubmitDeposit: ({ event }) => getDoneOutput(event).next === "submit-deposit",
		isSubmitWithdrawal: ({ event }) => getDoneOutput(event).next === "submit-withdrawal",
		isFinalizeDeposit: ({ event }) => getDoneOutput(event).next === "finalize-deposit",
		isCancelDeposit: ({ event }) => getDoneOutput(event).next === "cancel-deposit",
		isFinalizeWithdrawal: ({ event }) => getDoneOutput(event).next === "finalize-withdrawal",
		isWaitingDepositSubmission: ({ event }) =>
			getDoneOutput(event).next === "wait-deposit" &&
			getDoneOutput(event).session.phase === "waiting-submission",
		isWaitingDepositPriorClaims: ({ event }) =>
			getDoneOutput(event).next === "wait-deposit" &&
			getDoneOutput(event).session.phase === "waiting-prior-claims",
		isWaitingDepositFinalization: ({ event }) => getDoneOutput(event).next === "wait-deposit",
		isWaitingWithdrawalSubmission: ({ event }) =>
			getDoneOutput(event).next === "wait-withdrawal" &&
			getDoneOutput(event).session.phase === "waiting-submission",
		isWaitingWithdrawalPriorClaims: ({ event }) =>
			getDoneOutput(event).next === "wait-withdrawal" &&
			getDoneOutput(event).session.phase === "waiting-prior-claims",
		isWaitingWithdrawalFinalization: ({ event }) => getDoneOutput(event).next === "wait-withdrawal"
	}
}).createMachine({
	id: "bridge-cli-operation",
	context: ({ input }) => input,
	initial: "route",
	output: ({ context }) => context.session,
	states: {
		route: {
			always: [
				{
					target: "inspectingDeposit",
					guard: ({ context }) => context.session.direction === "deposit"
				},
				{ target: "inspectingWithdrawal" }
			]
		},
		submittingDeposit: {
			invoke: {
				src: "submitDeposit",
				input: actorInput,
				onDone: [...terminalRoutes, { target: "inspectingDeposit", actions: "applyRunnerOutput" }]
			}
		},
		submittingWithdrawal: {
			invoke: {
				src: "submitWithdrawal",
				input: actorInput,
				onDone: [
					...terminalRoutes,
					{ target: "inspectingWithdrawal", actions: "applyRunnerOutput" }
				]
			}
		},
		inspectingDeposit: {
			invoke: {
				src: "inspectDeposit",
				input: actorInput,
				onDone: [
					...terminalRoutes,
					{
						target: "submittingDeposit",
						guard: "isSubmitDeposit",
						actions: "applyRunnerOutput"
					},
					{
						target: "finalizingDeposit",
						guard: "isFinalizeDeposit",
						actions: "applyRunnerOutput"
					},
					{
						target: "cancelingDeposit",
						guard: "isCancelDeposit",
						actions: "applyRunnerOutput"
					},
					...routeDepositWait
				]
			}
		},
		inspectingWithdrawal: {
			invoke: {
				src: "inspectWithdrawal",
				input: actorInput,
				onDone: [
					...terminalRoutes,
					{
						target: "submittingWithdrawal",
						guard: "isSubmitWithdrawal",
						actions: "applyRunnerOutput"
					},
					{
						target: "finalizingWithdrawal",
						guard: "isFinalizeWithdrawal",
						actions: "applyRunnerOutput"
					},
					...routeWithdrawalWait
				]
			}
		},
		waitingDepositSubmission: {
			invoke: {
				src: "waitDeposit",
				input: actorInput,
				onDone: [...terminalRoutes, { target: "inspectingDeposit", actions: "applyRunnerOutput" }]
			}
		},
		waitingDepositPriorClaims: {
			invoke: {
				src: "waitDeposit",
				input: actorInput,
				onDone: [...terminalRoutes, { target: "inspectingDeposit", actions: "applyRunnerOutput" }]
			}
		},
		waitingDepositFinalization: {
			invoke: {
				src: "waitDeposit",
				input: actorInput,
				onDone: [...terminalRoutes, { target: "inspectingDeposit", actions: "applyRunnerOutput" }]
			}
		},
		waitingWithdrawalSubmission: {
			invoke: {
				src: "waitWithdrawal",
				input: actorInput,
				onDone: [
					...terminalRoutes,
					{ target: "inspectingWithdrawal", actions: "applyRunnerOutput" }
				]
			}
		},
		waitingWithdrawalPriorClaims: {
			invoke: {
				src: "waitWithdrawal",
				input: actorInput,
				onDone: [
					...terminalRoutes,
					{ target: "inspectingWithdrawal", actions: "applyRunnerOutput" }
				]
			}
		},
		waitingWithdrawalFinalization: {
			invoke: {
				src: "waitWithdrawal",
				input: actorInput,
				onDone: [
					...terminalRoutes,
					{ target: "inspectingWithdrawal", actions: "applyRunnerOutput" }
				]
			}
		},
		finalizingDeposit: {
			invoke: {
				src: "finalizeDeposit",
				input: actorInput,
				onDone: [...terminalRoutes, { target: "inspectingDeposit", actions: "applyRunnerOutput" }]
			}
		},
		cancelingDeposit: {
			invoke: {
				src: "cancelDeposit",
				input: actorInput,
				onDone: [...terminalRoutes, { target: "inspectingDeposit", actions: "applyRunnerOutput" }]
			}
		},
		finalizingWithdrawal: {
			invoke: {
				src: "finalizeWithdrawal",
				input: actorInput,
				onDone: [
					...terminalRoutes,
					{ target: "inspectingWithdrawal", actions: "applyRunnerOutput" }
				]
			}
		},
		completed: { type: "final" },
		cancelled: { type: "final" },
		failed: { type: "final" }
	}
})

export const runBridgeOperation = async (
	input: BridgeFlowInput,
	deps: BridgeFlowDeps
): Promise<OperationSession> => {
	const context = createInitialRunnerContext(input, deps)

	await persistSession({
		session: context.session,
		sessionStore: deps.sessionStore,
		log: deps.log,
		event: "initialized"
	})

	const actor = createActor(bridgeOperationMachine, { input: context })
	actor.start()
	try {
		return await toPromise(actor)
	} finally {
		actor.stop()
	}
}

const createAdapterWithRetries = async ({
	createAdapter,
	from,
	to,
	verbose,
	log,
	sleep,
	retryDelayMs
}: {
	createAdapter: BridgeAdapterFactory
	from: ChainRef
	to: ChainRef
	verbose: boolean
	log: LogFn
	sleep: (ms: number) => Promise<void>
	retryDelayMs?: number
}) =>
	retryWithBackoff({
		operation: "Bridge.init",
		baseDelayMs: retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
		maxRetries: DEFAULT_MAX_RETRIES,
		sleep,
		shouldRetry: isRetryableInitializationError,
		run: async () => await createAdapter({ from, to, verbose }),
		onRetry: ({ error, retryIndex, delayMs }) =>
			log({
				event: "retrying",
				phase: "initializing",
				details: {
					operation: "Bridge.init",
					attempt: retryIndex,
					nextDelayMs: delayMs,
					message: formatErrorMessage(error)
				}
			})
	})

export const createBridgeCommand = (deps: BridgeCommandDeps = {}): CommandDef<BridgeCommandArgs> =>
	defineCommand({
		meta: {
			name: "bridge",
			description: "Run a full bridge flow from source to destination."
		},
		args: {
			from: { type: "string", default: DEFAULT_FROM_CHAIN },
			to: { type: "string", default: DEFAULT_TO_CHAIN },
			amount: { type: "string", required: true },
			account: { type: "string", required: false },
			recipient: { type: "string", required: false },
			timeoutSlots: { type: "string", required: false, alias: ["timeout-slots"] },
			pollIntervalMs: { type: "string", required: false, alias: ["poll-interval-ms"] },
			retryDelayMs: { type: "string", required: false, alias: ["retry-delay-ms"] },
			json: { type: "boolean", default: false },
			verbose: { type: "boolean", default: false }
		},
		async run({ args }) {
			const commandArgs = parseBridgeCommandArgs(args)
			const from = commandArgs.from
			const to = commandArgs.to
			const account = deriveAccount(from, commandArgs.account)
			const recipient = commandArgs.recipient ?? deriveAccount(to)
			const appPaths = (deps.resolvePaths ?? resolveAppPaths)()
			const store = (deps.createStore ?? createSessionStore)({ stateDir: appPaths.stateDir })
			const id = (deps.generateId ?? randomUUID)()
			const logPath = path.join(appPaths.logDir, `${id}.jsonl`)
			const logger = (deps.createLogger ?? createOperationLogger)({ logPath })
			const createAdapter = deps.createAdapter ?? createDefaultBridgeAdapter
			const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
			const log: LogFn = async ({ event, phase, details }) => {
				;(deps.writeProgress ?? console.error)(renderOperationProgress({ event, phase, details }))
				await logger.write(event, { phase, ...details })
			}
			const session = await runBridgeOperation(
				{
					id,
					from,
					to,
					amount: commandArgs.amount,
					account,
					recipient,
					timeoutSlots:
						resolveRoute(from, to).direction === "deposit"
							? resolveDepositTimeoutSlots(commandArgs.timeoutSlots)
							: commandArgs.timeoutSlots
				},
				{
					adapter: await createAdapterWithRetries({
						createAdapter,
						from,
						to,
						verbose: commandArgs.verbose,
						log,
						sleep,
						retryDelayMs: commandArgs.retryDelayMs ?? deps.retryDelayMs
					}),
					sessionStore: {
						async save(operation) {
							await store.save({ ...operation, logPath })
						}
					},
					log,
					sleep,
					pollIntervalMs: commandArgs.pollIntervalMs ?? deps.pollIntervalMs ?? 20_000,
					retryDelayMs: commandArgs.retryDelayMs ?? deps.retryDelayMs,
					now: deps.now,
					verbose: commandArgs.verbose
				}
			)

			const finalSession = { ...session, logPath }
			;(deps.write ?? console.log)(
				commandArgs.json
					? JSON.stringify(toBridgeJsonResult(finalSession), null, 2)
					: renderBridgeResult(finalSession)
			)
		}
	})
