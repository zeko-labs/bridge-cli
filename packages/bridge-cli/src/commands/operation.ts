import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { defineCommand, type CommandDef } from "citty"
import { MINA_NETWORKS, ZEKO_M_NETWORKS } from "@zeko/networks"
import { PrivateKey } from "o1js"
import { runBridgeOperation } from "./bridge"
import type { BridgeAdapter } from "../core/adapter"
import { createDefaultBridgeAdapter, type BridgeAdapterFactory } from "../core/adapter-factory"
import { getSubmitHash } from "../core/bridge-queue"
import {
	readAliasedNumberArg,
	readBooleanArg,
	readOptionalStringArg,
	readRequiredStringArg
} from "../core/command-args"
import { createOperationLogger } from "../core/logger"
import { resolveAppPaths } from "../core/paths"
import {
	renderBridgeResult,
	renderOperationProgress,
	toBridgeJsonResult,
	type BridgeCommandJsonResult
} from "../core/reporter"
import { resolveSignerKeys } from "../core/signer"
import { createSessionStore, type SessionStore } from "../core/session-store"
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_MS, retryWithBackoff } from "../core/retry"
import type { ChainRef } from "../core/routes"
import { parseChainRef } from "../core/routes"
import type { OperationPhase, OperationSession } from "../core/types"
import {
	createResumeQueue,
	createResumedSession as createResumedSessionFromService,
	normalizeSessionForResume as normalizeSessionForResumeWithService,
	parseSessionRoute,
	projectOperationStatus,
	resolveResumeQueueRoutes,
	refreshSessionFromNetwork
} from "../core/operation-services"

type OperationCommandDeps = {
	createStore?: (input: { stateDir: string }) => Pick<SessionStore, "list" | "load" | "save">
	resolvePaths?: typeof resolveAppPaths
	createAdapter?: BridgeAdapterFactory
	readLog?: (path: string) => Promise<string>
	createLogger?: (input: { logPath: string }) => Pick<
		ReturnType<typeof createOperationLogger>,
		"write"
	>
	write?: (message: string) => void
	writeProgress?: (message: string) => void
	sleep?: (ms: number) => Promise<void>
	pollIntervalMs?: number
	heartbeatIntervalMs?: number
	retryDelayMs?: number
	generateId?: () => string
	now?: () => string
}

type OperationLogEntry = {
	event: string
	phase: OperationPhase
	details?: Record<string, unknown>
}

type ResumeAllResult = {
	success: boolean
	account: string
	operationsFound: number
	operationsResolved: number
	results: OperationSession[]
}

type ResumeAllJsonResult = {
	success: boolean
	account: string
	operations_found: number
	operations_resolved: number
	operations: Array<
		BridgeCommandJsonResult & {
			resolved: boolean
		}
	>
}

type CompletedOperationJsonResult = {
	count: number
	operations: BridgeCommandJsonResult[]
}

const DEFAULT_FROM_CHAIN = MINA_NETWORKS.testnet
const DEFAULT_TO_CHAIN = ZEKO_M_NETWORKS.testnet

const parseChainArg = (value: unknown, fallback: ChainRef, flag: "--from" | "--to"): ChainRef =>
	parseChainRef(typeof value === "string" ? value : fallback, flag)

const deriveAccount = (from: ChainRef, explicit?: string): string => {
	if (explicit) return explicit

	const keys = resolveSignerKeys()
	const secret =
		from === ZEKO_M_NETWORKS.testnet || from === ZEKO_M_NETWORKS.mainnet ? keys.zeko : keys.mina
	return PrivateKey.fromBase58(secret).toPublicKey().toBase58()
}

const toResumeAllJsonResult = (result: ResumeAllResult): ResumeAllJsonResult => ({
	success: result.success,
	account: result.account,
	operations_found: result.operationsFound,
	operations_resolved: result.operationsResolved,
	operations: result.results.map((session) => ({
		...toBridgeJsonResult(session),
		resolved: session.status === "completed" || session.status === "cancelled"
	}))
})

const renderResumeAllResult = (result: ResumeAllResult): string => {
	const lines = [
		`${result.success ? "Success" : "Failed"}: resumed ${result.operationsResolved}/${result.operationsFound} pending operation${result.operationsFound === 1 ? "" : "s"}`,
		`Account: ${result.account}`
	]

	for (const session of result.results) {
		lines.push(
			`- ${session.id} | ${session.direction} | ${session.route} | ${session.status} | submit=${getSubmitHash(session) ?? "-"} | final=${session.finalTransaction?.hash ?? "-"} | log=${session.logPath}`
		)
	}

	return lines.join("\n")
}

const isResolvedOperation = (session: OperationSession): boolean =>
	session.status === "completed" || session.status === "cancelled"

const renderCompletedOperations = (sessions: OperationSession[]): string => {
	const lines = [`Completed operations: ${sessions.length}`]

	if (sessions.length === 0) {
		lines.push("No completed or cancelled operations found.")
		return lines.join("\n")
	}

	for (const session of sessions) {
		lines.push(
			`- ${session.id} | ${session.status} | ${session.direction} | ${session.route} | submit=${getSubmitHash(session) ?? "-"} | final=${session.finalTransaction?.hash ?? "-"} | updated=${session.updatedAt}`
		)
	}

	return lines.join("\n")
}

const toCompletedOperationsJsonResult = (
	sessions: OperationSession[]
): CompletedOperationJsonResult => ({
	count: sessions.length,
	operations: sessions.map((session) => toBridgeJsonResult(session))
})

const refreshOperationSession = async ({
	session,
	createAdapter,
	now,
	verbose
}: {
	session: OperationSession
	createAdapter: BridgeAdapterFactory
	now: () => string
	verbose: boolean
}): Promise<OperationSession> => {
	const [from, to] = parseSessionRoute(session)
	const adapter = await createAdapter({ from, to, verbose })

	return refreshSessionFromNetwork({ session, adapter, now })
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
	log: (entry: {
		event: string
		phase: OperationPhase
		details?: Record<string, unknown>
	}) => Promise<void>
	sleep: (ms: number) => Promise<void>
	retryDelayMs: number
}): Promise<BridgeAdapter> => {
	const isRetryableInitializationError = (error: unknown): boolean => {
		const message = error instanceof Error ? error.message : String(error)
		return !/Missing required signer private key|Unsupported bridge route|Invalid private key/i.test(
			message
		)
	}

	return retryWithBackoff({
		operation: "Bridge.init",
		run: async () => await createAdapter({ from, to, verbose }),
		sleep,
		baseDelayMs: retryDelayMs,
		maxRetries: DEFAULT_MAX_RETRIES,
		shouldRetry: isRetryableInitializationError,
		onRetry: ({ error, retryIndex, delayMs }) =>
			log({
				event: "retrying",
				phase: "initializing",
				details: {
					operation: "Bridge.init",
					attempt: retryIndex,
					nextDelayMs: delayMs,
					message: error instanceof Error ? error.message : String(error)
				}
			})
	})
}

const createProgressLog = ({
	writeProgress,
	logger
}: {
	writeProgress: (message: string) => void
	logger?: Pick<ReturnType<typeof createOperationLogger>, "write">
}) => {
	return async ({ event, phase, details }: OperationLogEntry) => {
		writeProgress(renderOperationProgress({ event, phase, details }))
		await logger?.write(event, { phase, ...details })
	}
}

const resolveSleep = (deps: OperationCommandDeps): ((ms: number) => Promise<void>) =>
	deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

const resolveRetryDelayMs = (input: {
	argValue?: number
	deps: OperationCommandDeps
	fallback?: number
}): number => input.argValue ?? input.deps.retryDelayMs ?? input.fallback ?? DEFAULT_RETRY_DELAY_MS

const resolvePollIntervalMs = (input: {
	argValue?: number
	deps: OperationCommandDeps
}): number => input.argValue ?? input.deps.pollIntervalMs ?? 20_000

export const createOperationCommand = (deps: OperationCommandDeps = {}): CommandDef =>
	defineCommand({
		meta: {
			name: "operation",
			description: "Inspect or resume persisted bridge operations."
		},
		subCommands: {
			list: defineCommand({
				meta: { name: "list", description: "List persisted operations." },
				async run() {
					const store = (deps.createStore ?? createSessionStore)({
						stateDir: (deps.resolvePaths ?? resolveAppPaths)().stateDir
					})
					;(deps.write ?? console.log)(JSON.stringify(await store.list(), null, 2))
				}
			}),
			completed: defineCommand({
				meta: { name: "completed", description: "List completed and cancelled operations." },
				args: {
					json: { type: "boolean", default: false }
				},
				async run({ args }) {
					const json = readBooleanArg(args, "json")
					const store = (deps.createStore ?? createSessionStore)({
						stateDir: (deps.resolvePaths ?? resolveAppPaths)().stateDir
					})
					const completedSessions = (await store.list()).filter(isResolvedOperation)
					;(deps.write ?? console.log)(
						json
							? JSON.stringify(toCompletedOperationsJsonResult(completedSessions), null, 2)
							: renderCompletedOperations(completedSessions)
					)
				}
			}),
			status: defineCommand({
				meta: { name: "status", description: "Show one persisted operation." },
				args: {
					id: { type: "positional", required: true },
					verbose: { type: "boolean", default: false }
				},
				async run({ args }) {
					const id = readRequiredStringArg(args, "id", "Missing required operation id")
					const verbose = readBooleanArg(args, "verbose")
					const now = deps.now ?? (() => new Date().toISOString())
					const store = (deps.createStore ?? createSessionStore)({
						stateDir: (deps.resolvePaths ?? resolveAppPaths)().stateDir
					})
					const session = await store.load(id)
					if (!session) throw new Error(`Operation ${id} not found`)
					const createAdapter = deps.createAdapter ?? createDefaultBridgeAdapter
					;(deps.writeProgress ?? console.error)(
						renderOperationProgress({
							event: "refreshing-status",
							phase: session.phase,
							details: {
								operationId: session.id,
								route: session.route
							}
						})
					)
					const refreshed = await refreshOperationSession({
						session,
						createAdapter,
						now,
						verbose
					})
					await store.save(refreshed)
					;(deps.write ?? console.log)(JSON.stringify(projectOperationStatus(refreshed), null, 2))
				}
			}),
			logs: defineCommand({
				meta: { name: "logs", description: "Print the log file for an operation." },
				args: {
					id: { type: "positional", required: true }
				},
				async run({ args }) {
					const id = readRequiredStringArg(args, "id", "Missing required operation id")
					const store = (deps.createStore ?? createSessionStore)({
						stateDir: (deps.resolvePaths ?? resolveAppPaths)().stateDir
					})
					const session = await store.load(id)
					if (!session) throw new Error(`Operation ${id} not found`)
					;(deps.write ?? console.log)(
						await (deps.readLog ?? ((path) => readFile(path, "utf8")))(session.logPath)
					)
				}
			}),
			resume: defineCommand({
				meta: { name: "resume", description: "Resume a persisted operation." },
				args: {
					id: { type: "positional", required: true },
					pollIntervalMs: { type: "string", required: false, alias: ["poll-interval-ms"] },
					retryDelayMs: { type: "string", required: false, alias: ["retry-delay-ms"] },
					json: { type: "boolean", default: false },
					verbose: { type: "boolean", default: false }
				},
				async run({ args }) {
					const id = readRequiredStringArg(args, "id", "Missing required operation id")
					const json = readBooleanArg(args, "json")
					const verbose = readBooleanArg(args, "verbose")
					const pollIntervalMs = readAliasedNumberArg(
						args,
						"pollIntervalMs",
						"poll-interval-ms",
						"--poll-interval-ms"
					)
					const retryDelayMs = readAliasedNumberArg(
						args,
						"retryDelayMs",
						"retry-delay-ms",
						"--retry-delay-ms"
					)
					const now = deps.now ?? (() => new Date().toISOString())
					const appPaths = (deps.resolvePaths ?? resolveAppPaths)()
					const store = (deps.createStore ?? createSessionStore)({ stateDir: appPaths.stateDir })
					const session = await store.load(id)
					if (!session) throw new Error(`Operation ${id} not found`)
					const normalizedSession = normalizeSessionForResumeWithService({ session, now })
					const [from, to] = parseSessionRoute(session)
					const logger = (deps.createLogger ?? createOperationLogger)({
						logPath: session.logPath
					})
					const createAdapter = deps.createAdapter ?? createDefaultBridgeAdapter
					const sleep = resolveSleep(deps)
					const log = createProgressLog({
						writeProgress: deps.writeProgress ?? console.error,
						logger
					})
					const resumed = await runBridgeOperation(
						{
							id: normalizedSession.id,
							from,
							to,
							amount: normalizedSession.amount,
							account: normalizedSession.account,
							recipient: normalizedSession.recipient,
							timeoutSlots: normalizedSession.timeoutSlots,
							session: normalizedSession
						},
						{
							adapter: await createAdapterWithRetries({
								createAdapter,
								from,
								to,
								verbose,
								log,
								sleep,
								retryDelayMs: resolveRetryDelayMs({ argValue: retryDelayMs, deps })
							}),
							sessionStore: store,
							log,
							sleep,
							pollIntervalMs: resolvePollIntervalMs({ argValue: pollIntervalMs, deps }),
							retryDelayMs: retryDelayMs ?? deps.retryDelayMs,
							verbose
						}
					)
					;(deps.write ?? console.log)(
						json
							? JSON.stringify(toBridgeJsonResult(resumed), null, 2)
							: renderBridgeResult(resumed)
					)
				}
			}),
			"resume-all": defineCommand({
				meta: {
					name: "resume-all",
					description: "Discover and sequentially resume pending bridge operations for an account."
				},
				args: {
					from: { type: "string", default: DEFAULT_FROM_CHAIN },
					to: { type: "string", default: DEFAULT_TO_CHAIN },
					account: { type: "string", required: false },
					pollIntervalMs: { type: "string", required: false, alias: ["poll-interval-ms"] },
					retryDelayMs: { type: "string", required: false, alias: ["retry-delay-ms"] },
					json: { type: "boolean", default: false },
					verbose: { type: "boolean", default: false }
				},
				async run({ args }) {
					const from = parseChainArg(args.from, DEFAULT_FROM_CHAIN, "--from")
					const to = parseChainArg(args.to, DEFAULT_TO_CHAIN, "--to")
					const json = readBooleanArg(args, "json")
					const verbose = readBooleanArg(args, "verbose")
					const account = deriveAccount(from, readOptionalStringArg(args, "account"))
					const pollIntervalMs = readAliasedNumberArg(
						args,
						"pollIntervalMs",
						"poll-interval-ms",
						"--poll-interval-ms"
					)
					const retryDelayMs = readAliasedNumberArg(
						args,
						"retryDelayMs",
						"retry-delay-ms",
						"--retry-delay-ms"
					)
					const now = deps.now ?? (() => new Date().toISOString())
					const sleep = resolveSleep(deps)
					const appPaths = (deps.resolvePaths ?? resolveAppPaths)()
					const store = (deps.createStore ?? createSessionStore)({ stateDir: appPaths.stateDir })
					const createAdapter = deps.createAdapter ?? createDefaultBridgeAdapter
					const queueRoutes = resolveResumeQueueRoutes(from, to)
					const discoveryLog = createProgressLog({
						writeProgress: deps.writeProgress ?? console.error
					})
					const depositAdapter = await createAdapterWithRetries({
						createAdapter,
						from: queueRoutes.depositFrom,
						to: queueRoutes.depositTo,
						verbose,
						log: discoveryLog,
						sleep,
						retryDelayMs: resolveRetryDelayMs({ deps })
					})
					const withdrawalAdapter = await createAdapterWithRetries({
						createAdapter,
						from: queueRoutes.withdrawalFrom,
						to: queueRoutes.withdrawalTo,
						verbose,
						log: discoveryLog,
						sleep,
						retryDelayMs: resolveRetryDelayMs({ deps })
					})
					const [persistedSessions, depositStatuses, withdrawalStatuses] = await Promise.all([
						store.list(),
						depositAdapter.getDepositStatuses(account),
						withdrawalAdapter.getWithdrawalStatuses(account)
					])
					const queue = createResumeQueue({
						from,
						to,
						account,
						persistedSessions,
						depositStatuses,
						withdrawalStatuses
					})

					if (queue.length === 0) {
						const result: ResumeAllResult = {
							success: true,
							account,
							operationsFound: 0,
							operationsResolved: 0,
							results: []
						}
						;(deps.write ?? console.log)(
							json
								? JSON.stringify(toResumeAllJsonResult(result), null, 2)
								: renderResumeAllResult(result)
						)
						return
					}

					const results: OperationSession[] = []
					for (const item of queue) {
						const session = createResumedSessionFromService({
							item,
							account,
							now,
							logDir: appPaths.logDir,
							generateId: deps.generateId ?? randomUUID
						})
						const logger = (deps.createLogger ?? createOperationLogger)({
							logPath: session.logPath
						})
						const log = createProgressLog({
							writeProgress: deps.writeProgress ?? console.error,
							logger
						})

						await log({
							event: "queue-resume",
							phase: session.phase,
							details: {
								position: results.length + 1,
								total: queue.length,
								operationId: session.id,
								direction: session.direction,
								targetIndex: session.targetIndex
							}
						})

						const resumed = await runBridgeOperation(
							{
								id: session.id,
								from: item.from,
								to: item.to,
								amount: session.amount,
								account: session.account,
								recipient: session.recipient,
								timeoutSlots: session.timeoutSlots,
								session
							},
							{
								adapter: await createAdapterWithRetries({
									createAdapter,
									from: item.from,
									to: item.to,
									verbose,
									log,
									sleep,
									retryDelayMs: resolveRetryDelayMs({ argValue: retryDelayMs, deps })
								}),
								sessionStore: store,
								log,
								sleep,
								pollIntervalMs: resolvePollIntervalMs({ argValue: pollIntervalMs, deps }),
								retryDelayMs: retryDelayMs ?? deps.retryDelayMs,
								verbose,
								now
							}
						)

						results.push(resumed)
						if (resumed.status === "failed") {
							break
						}
					}

					const operationsResolved = results.filter(
						(session) => session.status === "completed" || session.status === "cancelled"
					).length
					const result: ResumeAllResult = {
						success:
							results.length === queue.length &&
							results.every(
								(session) => session.status === "completed" || session.status === "cancelled"
							),
						account,
						operationsFound: queue.length,
						operationsResolved,
						results
					}
					;(deps.write ?? console.log)(
						json
							? JSON.stringify(toResumeAllJsonResult(result), null, 2)
							: renderResumeAllResult(result)
					)
				}
			})
		}
	})
