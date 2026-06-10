import {
	analyzeDepositQueue,
	analyzeWithdrawalQueue,
	getSubmitHash,
	resolveEffectiveDepositClaimableIndex,
	sortByIndex,
	type DepositQueueState,
	type WithdrawalQueueState
} from "../bridge-queue"
import type {
	BridgeCapabilityDiagnostic,
	DepositStatus,
	OperationSession,
	WithdrawalStatus
} from "../types"

export type BridgeRuntimeAction =
	| "submit"
	| "wait"
	| "finalize"
	| "cancel"
	| "complete"
	| "cancelled"
	| "fail"

export type BridgeRuntimeDecision = {
	action: BridgeRuntimeAction
	phaseEvent?: "MARK_WAITING_SUBMISSION" | "MARK_WAITING_PRIOR_CLAIMS" | "MARK_WAITING_FINALIZATION"
	waitEvent?: "waiting-for-submission" | "waiting-on-prior-claims" | "waiting-for-finalization"
	waitSignature?: string
	details?: Record<string, unknown>
	claimableIndex?: number
	cancelMarker?: string
	analysis?: DepositQueueState | WithdrawalQueueState
}

type DepositDecisionInput = {
	session: OperationSession
	statuses: DepositStatus[]
	canFinalize: BridgeCapabilityDiagnostic
	canCancel: BridgeCapabilityDiagnostic
	now?: () => string
}

type WithdrawalDecisionInput = {
	session: OperationSession
	statuses: WithdrawalStatus[]
	canFinalize: BridgeCapabilityDiagnostic
	now?: () => string
}

const FINALIZE_RETRY_AFTER_MS = 180_000

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

const getPendingFinalizeRetryState = ({
	session,
	claimableIndex,
	now
}: {
	session: OperationSession
	claimableIndex: number | undefined
	now: () => string
}): { isPending: boolean; isStale: boolean } => {
	if (claimableIndex === undefined || session.pendingFinalizeIndex !== claimableIndex) {
		return { isPending: false, isStale: false }
	}

	const submittedAt = session.pendingFinalizeSubmittedAt
	if (!submittedAt) {
		return { isPending: true, isStale: true }
	}

	const submittedAtMs = Date.parse(submittedAt)
	const nowMs = Date.parse(now())
	if (Number.isNaN(submittedAtMs) || Number.isNaN(nowMs)) {
		return { isPending: true, isStale: true }
	}

	return {
		isPending: true,
		isStale: nowMs - submittedAtMs >= FINALIZE_RETRY_AFTER_MS
	}
}

const hasSubmittedTargetFinalization = ({
	session,
	claimableIndex
}: {
	session: OperationSession
	claimableIndex: number | undefined
}): boolean =>
	claimableIndex !== undefined &&
	session.pendingFinalizeIndex === claimableIndex &&
	session.finalTransaction?.action === "finalize"

const waitForDeposit = ({
	session,
	analysis,
	effectiveClaimableIndex
}: {
	session: OperationSession
	analysis: DepositQueueState
	effectiveClaimableIndex?: number
}): BridgeRuntimeDecision => {
	const { target, targetIndex, claimableIndex, pendingAhead, blockingAhead, skippableAhead } =
		analysis
	const hasSubmittedDeposit = getSubmitHash(session) !== undefined

	if (analysis.shouldAdvanceQueuedClaims) {
		return {
			action: "wait",
			analysis,
			phaseEvent: "MARK_WAITING_PRIOR_CLAIMS",
			waitEvent: "waiting-on-prior-claims",
			waitSignature: `prior:${targetIndex ?? "unknown"}:${claimableIndex ?? "none"}:${pendingAhead}:${blockingAhead}:${skippableAhead}`,
			details: {
				waiting: "prior-claims",
				targetIndex,
				pendingAhead,
				blockingAhead,
				skippableAhead,
				claimIndex: effectiveClaimableIndex ?? claimableIndex
			}
		}
	}

	if (!target) {
		return {
			action: "wait",
			analysis,
			phaseEvent: "MARK_WAITING_SUBMISSION",
			waitEvent: "waiting-for-submission",
			waitSignature: "submission:pending",
			details: { waiting: "submission", submitHash: getSubmitHash(session) }
		}
	}

	return {
		action: "wait",
		analysis,
		phaseEvent: "MARK_WAITING_FINALIZATION",
		waitEvent: "waiting-for-finalization",
		waitSignature: `finalization:${target.index}:${claimableIndex ?? "none"}`,
		details: {
			waiting: "finalization",
			targetIndex: target.index,
			claimIndex: effectiveClaimableIndex ?? claimableIndex,
			targetIndexPatch: hasSubmittedDeposit ? target.index : undefined
		}
	}
}

export const decideDepositStep = ({
	session,
	statuses,
	canFinalize,
	canCancel,
	now = () => new Date().toISOString()
}: DepositDecisionInput): BridgeRuntimeDecision => {
	const sortedStatuses = sortByIndex(statuses)
	const hasSubmittedDeposit = getSubmitHash(session) !== undefined
	const unresolvedStatuses = sortedStatuses.filter(
		(status) => !status.finalised && !status.cancelled
	)
	const analysis = analyzeDepositQueue({
		session: hasSubmittedDeposit ? session : { ...session, targetIndex: undefined },
		statuses: sortedStatuses
	})
	const { target, targetIndex, claimableIndex, pendingAhead, skippableAhead } = analysis

	if (hasSubmittedDeposit && target?.cancelled) {
		return { action: "cancelled", analysis }
	}

	if ((hasSubmittedDeposit || session.finalTransaction !== undefined) && target?.finalised) {
		return { action: "complete", analysis }
	}

	if (!hasSubmittedDeposit && unresolvedStatuses.length === 0) {
		return { action: "submit", analysis }
	}

	const effectiveClaimableIndex = resolveEffectiveDepositClaimableIndex({
		claimableIndex: canFinalize.index ?? claimableIndex,
		target,
		pendingAhead,
		canFinalize: canFinalize.available
	})
	const analysisWithEffectiveClaim = { ...analysis, effectiveClaimableIndex }
	const pendingFinalizeState = getPendingFinalizeRetryState({
		session,
		claimableIndex: effectiveClaimableIndex ?? targetIndex,
		now
	})
	const currentTargetCancelMarker = toPendingCancelMarker({
		currentTargetIndex: target?.index,
		claimableIndex,
		pendingAhead,
		isCurrentTarget: true
	})
	const priorCancelMarker = toPendingCancelMarker({
		currentTargetIndex: target?.index,
		claimableIndex,
		pendingAhead,
		isCurrentTarget: false
	})
	const shouldCancelCurrentTarget =
		hasSubmittedDeposit &&
		target !== undefined &&
		pendingAhead === 0 &&
		!canFinalize.available &&
		canCancel.available &&
		session.pendingCancelMarker !== currentTargetCancelMarker
	const shouldCancelPreSubmitTarget =
		!hasSubmittedDeposit &&
		target !== undefined &&
		pendingAhead === 0 &&
		!canFinalize.available &&
		canCancel.available &&
		session.pendingCancelMarker !== priorCancelMarker
	const shouldFinalize =
		canFinalize.available &&
		capabilityAppliesToIndex(canFinalize, effectiveClaimableIndex) &&
		!hasSubmittedTargetFinalization({ session, claimableIndex: effectiveClaimableIndex }) &&
		(!pendingFinalizeState.isPending || pendingFinalizeState.isStale) &&
		skippableAhead === 0 &&
		!shouldCancelCurrentTarget

	if (shouldFinalize) {
		return {
			action: "finalize",
			analysis: analysisWithEffectiveClaim,
			claimableIndex: effectiveClaimableIndex
		}
	}

	const shouldAdvancePriorCancellation =
		canCancel.available && skippableAhead > 0 && session.pendingCancelMarker !== priorCancelMarker

	if (shouldAdvancePriorCancellation || shouldCancelCurrentTarget || shouldCancelPreSubmitTarget) {
		return {
			action: "cancel",
			analysis,
			cancelMarker: shouldCancelCurrentTarget ? currentTargetCancelMarker : priorCancelMarker
		}
	}

	return waitForDeposit({ session, analysis: analysisWithEffectiveClaim, effectiveClaimableIndex })
}

const waitForWithdrawal = ({
	session,
	analysis,
	canFinalize
}: {
	session: OperationSession
	analysis: WithdrawalQueueState
	canFinalize: BridgeCapabilityDiagnostic
}): BridgeRuntimeDecision => {
	const { target, targetIndex, claimableIndex, pendingAhead } = analysis

	if (target && !target.committed && !analysis.shouldAdvanceQueuedClaims) {
		return {
			action: "wait",
			analysis,
			phaseEvent: "MARK_WAITING_SUBMISSION",
			waitEvent: "waiting-for-submission",
			waitSignature: `submission:commit:${target.index}`,
			details: {
				waiting: "submission",
				targetIndex: target.index,
				submitHash: getSubmitHash(session)
			}
		}
	}

	if (analysis.shouldAdvanceQueuedClaims) {
		return {
			action: "wait",
			analysis,
			phaseEvent: "MARK_WAITING_PRIOR_CLAIMS",
			waitEvent: "waiting-on-prior-claims",
			waitSignature: `prior:${targetIndex ?? "unknown"}:${claimableIndex ?? "none"}:${pendingAhead}`,
			details: {
				waiting: "prior-claims",
				targetIndex,
				pendingAhead,
				claimIndex: claimableIndex,
				finalizeAvailable: canFinalize.available,
				finalizeReason: canFinalize.reason
			}
		}
	}

	if (!target || !target.committed) {
		return {
			action: "wait",
			analysis,
			phaseEvent: "MARK_WAITING_SUBMISSION",
			waitEvent: "waiting-for-submission",
			waitSignature: target ? `submission:commit:${target.index}` : "submission:pending",
			details: {
				waiting: "submission",
				targetIndex: target?.index,
				submitHash: getSubmitHash(session)
			}
		}
	}

	return {
		action: "wait",
		analysis,
		phaseEvent: "MARK_WAITING_FINALIZATION",
		waitEvent: "waiting-for-finalization",
		waitSignature: `finalization:${target.index}:${claimableIndex ?? "none"}`,
		details: {
			waiting: "finalization",
			targetIndex: target.index,
			claimIndex: claimableIndex,
			finalizeAvailable: canFinalize.available,
			finalizeReason: canFinalize.reason
		}
	}
}

export const decideWithdrawalStep = ({
	session,
	statuses,
	canFinalize,
	now = () => new Date().toISOString()
}: WithdrawalDecisionInput): BridgeRuntimeDecision => {
	const sortedStatuses = sortByIndex(statuses)
	const hasSubmittedWithdrawal = getSubmitHash(session) !== undefined
	const unresolvedStatuses = sortedStatuses.filter((status) => !status.finalised)
	const analysis = analyzeWithdrawalQueue({
		session,
		statuses: sortedStatuses
	})
	const { target, claimableIndex, pendingAhead, shouldAdvanceQueuedClaims } = analysis

	if ((hasSubmittedWithdrawal || session.finalTransaction !== undefined) && target?.finalised) {
		return { action: "complete", analysis }
	}

	if (!hasSubmittedWithdrawal && unresolvedStatuses.length === 0) {
		return { action: "submit", analysis }
	}

	if (
		target?.committed &&
		pendingAhead === 0 &&
		isAlreadyFinalisedWithdrawal(canFinalize) &&
		terminalWithdrawalMatchesIndex(canFinalize, target.index)
	) {
		return { action: "complete", analysis }
	}

	const pendingFinalizeState = getPendingFinalizeRetryState({
		session,
		claimableIndex,
		now
	})

	const shouldFinalize =
		canFinalize.available &&
		claimableIndex !== undefined &&
		capabilityAppliesToIndex(canFinalize, claimableIndex) &&
		!hasSubmittedTargetFinalization({ session, claimableIndex }) &&
		(!pendingFinalizeState.isPending || pendingFinalizeState.isStale) &&
		(shouldAdvanceQueuedClaims || claimableIndex === target?.index)

	if (shouldFinalize) {
		return {
			action: "finalize",
			analysis,
			claimableIndex
		}
	}

	return waitForWithdrawal({ session, analysis, canFinalize })
}
