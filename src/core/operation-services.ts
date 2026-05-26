import path from "node:path"
import {
	analyzeDepositQueue,
	analyzeWithdrawalQueue,
	getSubmitHash,
	sortByIndex
} from "./bridge-queue"
import type { BridgeAdapter } from "./adapter"
import { formatRoute, parseRouteString, resolveRoute, type ChainRef } from "./routes"
import { getWithdrawalStatusSourceSnapshot } from "./status-sources"
import type {
	BridgeCapabilityDiagnostic,
	BridgeStatusSourceSnapshot,
	DepositStatus,
	OperationLiveSnapshot,
	OperationSession,
	WithdrawalStatus
} from "./types"

export type OperationStatusJsonResult = {
	id: string
	status: OperationSession["status"]
	phase: string
	route: OperationSession["route"]
	direction: OperationSession["direction"]
	account: string
	recipient: string
	amount: string
	timeout_slots?: number
	log_path: string
	created_at: string
	updated_at: string
	refreshed_at?: string
	submitted_transactions: OperationSession["submittedTransactions"]
	final_transaction: OperationSession["finalTransaction"] | null
	target_index?: number
	claimable_index?: number
	pending_ahead?: number
	can_finalize?: boolean
	can_cancel?: boolean
	submit_hash?: string
	observed_counts?: OperationLiveSnapshot["observedCounts"]
	status_sources?: Partial<Record<OperationSession["direction"], BridgeStatusSourceSnapshot>>
	next_action?: OperationLiveSnapshot["nextAction"]
	waiting_on?: OperationLiveSnapshot["waitingOn"]
	error: string | null
}

export type ResumeQueueItem =
	| {
			direction: "deposit"
			from: ChainRef
			to: ChainRef
			target: DepositStatus
			session?: OperationSession
	  }
	| {
			direction: "withdrawal"
			from: ChainRef
			to: ChainRef
			target: WithdrawalStatus
			session?: OperationSession
	  }

export const toOperationStatusPhase = (session: OperationSession): string => {
	const snapshot = session.liveSnapshot
	if (!snapshot) return session.phase

	if (snapshot.nextAction === "finalize") return "ready-finalization"
	if (snapshot.nextAction === "cancel") return "ready-cancellation"
	if (snapshot.nextAction === "completed") return "completed"
	if (snapshot.nextAction === "cancelled") return "cancelled"
	if (snapshot.waitingOn === "submission") return "waiting-submission"
	if (snapshot.waitingOn === "prior-claims") return "waiting-prior-claims"
	if (snapshot.waitingOn === "finalization") return "waiting-finalization"

	return session.phase
}

export const projectOperationStatus = (session: OperationSession): OperationStatusJsonResult => ({
	id: session.id,
	status: session.status,
	phase: toOperationStatusPhase(session),
	route: session.route,
	direction: session.direction,
	account: session.account,
	recipient: session.recipient ?? session.account,
	amount: session.amount,
	...(session.timeoutSlots !== undefined ? { timeout_slots: session.timeoutSlots } : {}),
	log_path: session.logPath,
	created_at: session.createdAt,
	updated_at: session.updatedAt,
	...(session.liveSnapshot?.refreshedAt ? { refreshed_at: session.liveSnapshot.refreshedAt } : {}),
	submitted_transactions: session.submittedTransactions,
	final_transaction: session.finalTransaction ?? null,
	...(session.liveSnapshot?.targetIndex !== undefined
		? { target_index: session.liveSnapshot.targetIndex }
		: session.targetIndex !== undefined
			? { target_index: session.targetIndex }
			: {}),
	...(session.liveSnapshot?.claimableIndex !== undefined
		? { claimable_index: session.liveSnapshot.claimableIndex }
		: {}),
	...(session.liveSnapshot?.pendingAhead !== undefined
		? { pending_ahead: session.liveSnapshot.pendingAhead }
		: {}),
	...(session.liveSnapshot?.canFinalize !== undefined
		? { can_finalize: session.liveSnapshot.canFinalize }
		: {}),
	...(session.liveSnapshot?.canCancel !== undefined
		? { can_cancel: session.liveSnapshot.canCancel }
		: {}),
	...(session.liveSnapshot?.submitHash ? { submit_hash: session.liveSnapshot.submitHash } : {}),
	...(session.liveSnapshot?.observedCounts
		? { observed_counts: session.liveSnapshot.observedCounts }
		: {}),
	...(session.liveSnapshot?.statusSources
		? { status_sources: session.liveSnapshot.statusSources }
		: {}),
	...(session.liveSnapshot?.nextAction ? { next_action: session.liveSnapshot.nextAction } : {}),
	...(session.liveSnapshot?.waitingOn ? { waiting_on: session.liveSnapshot.waitingOn } : {}),
	error: session.lastError ?? null
})

export const resolveResumeQueueRoutes = (from: ChainRef, to: ChainRef) => {
	const route = resolveRoute(from, to)
	return route.direction === "deposit"
		? {
				depositFrom: from,
				depositTo: to,
				withdrawalFrom: to,
				withdrawalTo: from
			}
		: {
				depositFrom: to,
				depositTo: from,
				withdrawalFrom: from,
				withdrawalTo: to
			}
}

export const matchesPendingItem = ({
	session,
	direction,
	from,
	to,
	account,
	hash
}: {
	session: OperationSession
	direction: "deposit" | "withdrawal"
	from: ChainRef
	to: ChainRef
	account: string
	hash: string
}): boolean =>
	session.direction === direction &&
	session.route === formatRoute(from, to) &&
	session.account === account &&
	getSubmitHash(session) === hash

export const createResumeQueue = ({
	from,
	to,
	account,
	persistedSessions,
	depositStatuses,
	withdrawalStatuses
}: {
	from: ChainRef
	to: ChainRef
	account: string
	persistedSessions: OperationSession[]
	depositStatuses: DepositStatus[]
	withdrawalStatuses: WithdrawalStatus[]
}): ResumeQueueItem[] => {
	const queueRoutes = resolveResumeQueueRoutes(from, to)
	const depositQueue: ResumeQueueItem[] = sortByIndex(depositStatuses)
		.filter((status) => !status.finalised && !status.cancelled)
		.map((target) => ({
			direction: "deposit" as const,
			from: queueRoutes.depositFrom,
			to: queueRoutes.depositTo,
			target,
			session: persistedSessions.find((session) =>
				matchesPendingItem({
					session,
					direction: "deposit",
					from: queueRoutes.depositFrom,
					to: queueRoutes.depositTo,
					account,
					hash: target.hash
				})
			)
		}))
	const withdrawalQueue: ResumeQueueItem[] = sortByIndex(withdrawalStatuses)
		.filter((status) => !status.finalised)
		.map((target) => ({
			direction: "withdrawal" as const,
			from: queueRoutes.withdrawalFrom,
			to: queueRoutes.withdrawalTo,
			target,
			session: persistedSessions.find((session) =>
				matchesPendingItem({
					session,
					direction: "withdrawal",
					from: queueRoutes.withdrawalFrom,
					to: queueRoutes.withdrawalTo,
					account,
					hash: target.hash
				})
			)
		}))

	return resolveRoute(from, to).direction === "withdrawal"
		? [...withdrawalQueue, ...depositQueue]
		: [...depositQueue, ...withdrawalQueue]
}

export const withSubmittedHash = ({
	session,
	hash
}: {
	session: OperationSession
	hash: string
}): OperationSession => {
	if (session.submittedTransactions.some((transaction) => transaction.action === "submit")) {
		return session.submittedTransactions.some(
			(transaction) => transaction.action === "submit" && transaction.hash === hash
		)
			? session
			: {
					...session,
					submittedTransactions: [
						{ action: "submit", hash },
						...session.submittedTransactions.filter(
							(transaction) => transaction.action !== "submit"
						)
					]
				}
	}

	return {
		...session,
		submittedTransactions: [{ action: "submit", hash }, ...session.submittedTransactions]
	}
}

export const createResumedSession = ({
	item,
	account,
	now,
	logDir,
	generateId
}: {
	item: ResumeQueueItem
	account: string
	now: () => string
	logDir: string
	generateId: () => string
}): OperationSession => {
	const existing = item.session
	const id = existing?.id ?? generateId()
	const logPath =
		existing?.logPath && existing.logPath.length > 0
			? existing.logPath
			: path.join(logDir, `${id}.jsonl`)
	const next = withSubmittedHash({
		session:
			existing ??
			({
				id,
				status: "running",
				phase: "submitted",
				route: formatRoute(item.from, item.to),
				direction: item.direction,
				account,
				recipient: item.target.recipient,
				amount: item.target.amount,
				logPath,
				createdAt: now(),
				updatedAt: now(),
				submittedTransactions: []
			} satisfies OperationSession),
		hash: item.target.hash
	})

	return {
		...next,
		status: "running",
		phase: "submitted",
		route: formatRoute(item.from, item.to),
		direction: item.direction,
		account,
		recipient: item.target.recipient,
		amount: item.target.amount,
		logPath,
		targetIndex: item.target.index,
		pendingFinalizeIndex: undefined,
		finalTransaction: undefined,
		lastError: undefined,
		updatedAt: now()
	}
}

export const normalizeSessionForResume = ({
	session,
	now
}: {
	session: OperationSession
	now: () => string
}): OperationSession =>
	session.status !== "failed"
		? session
		: {
				...session,
				status: "running",
				phase: "submitted",
				lastError: undefined,
				updatedAt: now()
			}

const normalizeCapabilityResult = (
	result: boolean | BridgeCapabilityDiagnostic
): BridgeCapabilityDiagnostic =>
	typeof result === "boolean" ? { available: result, reason: null } : result

const capabilityAppliesToIndex = (
	diagnostic: BridgeCapabilityDiagnostic,
	index: number | undefined
): boolean => index !== undefined && (diagnostic.index === undefined || diagnostic.index === index)

const terminalWithdrawalMatchesIndex = (
	diagnostic: BridgeCapabilityDiagnostic,
	index: number | undefined
): boolean => index !== undefined && diagnostic.index === index

const isAlreadyFinalisedWithdrawal = (diagnostic: BridgeCapabilityDiagnostic): boolean =>
	diagnostic.status === "alreadyFinalised" || diagnostic.reason === "Withdrawal already finalised"

const withLiveSnapshot = ({
	session,
	now,
	patch,
	liveSnapshot
}: {
	session: OperationSession
	now: () => string
	patch: Partial<OperationSession>
	liveSnapshot: OperationLiveSnapshot
}): OperationSession => ({
	...session,
	...patch,
	liveSnapshot,
	updatedAt: now()
})

export const refreshDepositSessionSnapshot = async ({
	session,
	deposits,
	canFinalizeResult,
	canCancelResult,
	now
}: {
	session: OperationSession
	deposits: DepositStatus[]
	canFinalizeResult: boolean | BridgeCapabilityDiagnostic
	canCancelResult: boolean | BridgeCapabilityDiagnostic
	now: () => string
}): Promise<OperationSession> => {
	const sortedDeposits = sortByIndex(deposits)
	const analysis = analyzeDepositQueue({ session, statuses: sortedDeposits })
	const canFinalizeDiagnostic = normalizeCapabilityResult(canFinalizeResult)
	const canCancelDiagnostic = normalizeCapabilityResult(canCancelResult)
	const canFinalize = canFinalizeDiagnostic.available
	const canCancel = canCancelDiagnostic.available
	const effectiveClaimableIndex = canFinalizeDiagnostic.index ?? analysis.claimableIndex
	const liveBase = {
		refreshedAt: now(),
		targetIndex: analysis.targetIndex,
		claimableIndex: effectiveClaimableIndex,
		pendingAhead: analysis.pendingAhead,
		canFinalize,
		canCancel,
		submitHash: getSubmitHash(session),
		observedCounts: {
			deposits: sortedDeposits.length,
			withdrawals: 0
		}
	} satisfies Omit<OperationLiveSnapshot, "nextAction">

	if (analysis.target?.cancelled) {
		return withLiveSnapshot({
			session,
			now,
			patch: {
				status: "cancelled",
				phase: "cancelled",
				lastError: undefined,
				targetIndex: analysis.target.index,
				pendingFinalizeIndex: undefined,
				pendingFinalizeSubmittedAt: undefined,
				pendingCancelMarker: undefined,
				finalTransaction: session.finalTransaction ?? {
					action: "cancel",
					hash: analysis.target.hash,
					explorerUrl: ""
				}
			},
			liveSnapshot: { ...liveBase, nextAction: "cancelled" }
		})
	}

	if (analysis.target?.finalised) {
		return withLiveSnapshot({
			session,
			now,
			patch: {
				status: "completed",
				phase: "completed",
				lastError: undefined,
				targetIndex: analysis.target.index,
				pendingFinalizeIndex: undefined,
				pendingFinalizeSubmittedAt: undefined,
				pendingCancelMarker: undefined,
				finalTransaction: session.finalTransaction ?? {
					action: "finalize",
					hash: analysis.target.hash,
					explorerUrl: ""
				}
			},
			liveSnapshot: { ...liveBase, nextAction: "completed" }
		})
	}

	const shouldFinalize =
		canFinalize &&
		effectiveClaimableIndex !== undefined &&
		capabilityAppliesToIndex(canFinalizeDiagnostic, effectiveClaimableIndex) &&
		analysis.skippableAhead === 0 &&
		(analysis.target === undefined ||
			analysis.blockingAhead > 0 ||
			effectiveClaimableIndex === analysis.target.index)
	const shouldCancel =
		canCancel &&
		(analysis.skippableAhead > 0 ||
			(analysis.target !== undefined && analysis.pendingAhead === 0 && !canFinalize))
	const waitingOn =
		analysis.target === undefined
			? "submission"
			: analysis.shouldAdvanceQueuedClaims
				? "prior-claims"
				: "finalization"
	const phase =
		waitingOn === "submission"
			? "waiting-submission"
			: waitingOn === "prior-claims"
				? "waiting-prior-claims"
				: "waiting-finalization"

	return withLiveSnapshot({
		session,
		now,
		patch: {
			status: "running",
			phase,
			lastError: undefined,
			targetIndex: analysis.targetIndex
		},
		liveSnapshot: {
			...liveBase,
			nextAction: shouldFinalize ? "finalize" : shouldCancel ? "cancel" : "wait",
			waitingOn
		}
	})
}

export const refreshWithdrawalSessionSnapshot = async ({
	session,
	withdrawals,
	canFinalizeResult,
	statusSourceSnapshot,
	now
}: {
	session: OperationSession
	withdrawals: WithdrawalStatus[]
	canFinalizeResult: BridgeCapabilityDiagnostic
	statusSourceSnapshot?: BridgeStatusSourceSnapshot
	now: () => string
}): Promise<OperationSession> => {
	const sortedWithdrawals = sortByIndex(withdrawals)
	const analysis = analyzeWithdrawalQueue({ session, statuses: sortedWithdrawals })
	const canFinalize = canFinalizeResult.available
	const liveBase = {
		refreshedAt: now(),
		targetIndex: analysis.targetIndex,
		claimableIndex: analysis.claimableIndex,
		pendingAhead: analysis.pendingAhead,
		canFinalize,
		submitHash: getSubmitHash(session),
		observedCounts: {
			deposits: 0,
			withdrawals: sortedWithdrawals.length
		},
		...(statusSourceSnapshot ? { statusSources: { withdrawal: statusSourceSnapshot } } : {})
	} satisfies Omit<OperationLiveSnapshot, "nextAction">

	if (analysis.target?.finalised) {
		return withLiveSnapshot({
			session,
			now,
			patch: {
				status: "completed",
				phase: "completed",
				lastError: undefined,
				targetIndex: analysis.target.index,
				pendingFinalizeIndex: undefined,
				pendingFinalizeSubmittedAt: undefined,
				finalTransaction: session.finalTransaction ?? {
					action: "finalize",
					hash: analysis.target.hash,
					explorerUrl: ""
				}
			},
			liveSnapshot: { ...liveBase, nextAction: "completed" }
		})
	}

	if (
		analysis.target?.committed &&
		analysis.pendingAhead === 0 &&
		isAlreadyFinalisedWithdrawal(canFinalizeResult) &&
		terminalWithdrawalMatchesIndex(canFinalizeResult, analysis.target.index)
	) {
		return withLiveSnapshot({
			session,
			now,
			patch: {
				status: "completed",
				phase: "completed",
				lastError: undefined,
				targetIndex: analysis.target.index,
				pendingFinalizeIndex: undefined,
				pendingFinalizeSubmittedAt: undefined,
				finalTransaction: session.finalTransaction ?? {
					action: "finalize",
					hash: analysis.target.hash,
					explorerUrl: ""
				}
			},
			liveSnapshot: { ...liveBase, nextAction: "completed" }
		})
	}

	const shouldFinalize =
		canFinalize &&
		analysis.claimableIndex !== undefined &&
		capabilityAppliesToIndex(canFinalizeResult, analysis.claimableIndex) &&
		(analysis.shouldAdvanceQueuedClaims || analysis.claimableIndex === analysis.target?.index)
	const waitingOn =
		analysis.target === undefined || analysis.target.committed === false
			? "submission"
			: analysis.shouldAdvanceQueuedClaims
				? "prior-claims"
				: "finalization"
	const phase =
		waitingOn === "submission"
			? "waiting-submission"
			: waitingOn === "prior-claims"
				? "waiting-prior-claims"
				: "waiting-finalization"

	return withLiveSnapshot({
		session,
		now,
		patch: {
			status: "running",
			phase,
			lastError: undefined,
			targetIndex: analysis.targetIndex
		},
		liveSnapshot: {
			...liveBase,
			nextAction: shouldFinalize ? "finalize" : "wait",
			waitingOn
		}
	})
}

export const refreshSessionFromNetwork = async ({
	session,
	adapter,
	now
}: {
	session: OperationSession
	adapter: Pick<
		BridgeAdapter,
		| "getDepositStatuses"
		| "getWithdrawalStatuses"
		| "canFinalizeDeposit"
		| "canCancelDeposit"
		| "canFinalizeWithdrawal"
		| "getStatusSources"
	>
	now: () => string
}): Promise<OperationSession> => {
	if (session.direction === "deposit") {
		const deposits = sortByIndex(await adapter.getDepositStatuses(session.account))
		const [canFinalizeResult, canCancelResult] = await Promise.all([
			adapter.canFinalizeDeposit
				? adapter.canFinalizeDeposit(session.account)
				: Promise.resolve(false as boolean | BridgeCapabilityDiagnostic),
			adapter.canCancelDeposit
				? adapter.canCancelDeposit(session.account)
				: Promise.resolve(false as boolean | BridgeCapabilityDiagnostic)
		])

		return refreshDepositSessionSnapshot({
			session,
			deposits,
			canFinalizeResult,
			canCancelResult,
			now
		})
	}

	const withdrawals = sortByIndex(await adapter.getWithdrawalStatuses(session.account))
	const statusSourceSnapshot = getWithdrawalStatusSourceSnapshot({
		adapter,
		statuses: withdrawals,
		submitHash: getSubmitHash(session)
	})
	const analysis = analyzeWithdrawalQueue({ session, statuses: withdrawals })
	const shouldCheckFinalize =
		analysis.shouldAdvanceQueuedClaims || analysis.target?.committed === true
	const canFinalizeResult =
		shouldCheckFinalize && adapter.canFinalizeWithdrawal
			? normalizeCapabilityResult(await adapter.canFinalizeWithdrawal(session.account))
			: { available: false, reason: null }

	return refreshWithdrawalSessionSnapshot({
		session,
		withdrawals,
		canFinalizeResult,
		statusSourceSnapshot,
		now
	})
}

export const parseSessionRoute = (session: OperationSession): [ChainRef, ChainRef] =>
	parseRouteString(session.route)
