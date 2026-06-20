import type { ChainRef, Direction } from "./routes"

export type DepositStatus = {
	index: number
	amount: string
	recipient: string
	cancelled: boolean
	cancellable?: boolean
	synced: boolean
	accepted: boolean
	confirmed: boolean
	finalised: boolean
	hash: string
	timestamp: string
}

export type WithdrawalStatus = {
	index: number
	amount: string
	recipient: string
	committed: boolean
	finalised: boolean
	hash: string
	timestamp: string
}

export type TransactionResult = {
	success: true
	direction: Direction
	action: "submit" | "finalize" | "cancel"
	route: `${ChainRef}->${ChainRef}`
	hash: string
	explorerUrl: string
	included: boolean
	zkAppId?: string
}

export type BridgeCapabilityDiagnostic = {
	available: boolean
	reason: string | null
	status?: "available" | "alreadyFinalised" | "waiting" | "blocked"
	index?: number
}

export type BridgeStatusSource = {
	name: string
	endpoint: string
	role: string
}

export type BridgeStatusSources = {
	deposits?: BridgeStatusSource[]
	withdrawals?: BridgeStatusSource[]
}

export type BridgeCommitSnapshot = {
	checkedAt: string
	slotStatus: {
		currentSlot: number | null
		withdrawalDelay: number
		depositCommitPastSlot: number | null
	}
	l1: {
		archiveUrl: string
		bridgeContract: string
		networkState: {
			canonicalMaxBlockHeight: number
			pendingMaxBlockHeight: number
		} | null
		lastCommit: {
			timestamp: string
			timestampIso: string | null
			height: number
			chainStatus: string
			distanceFromMaxBlockHeight: number | null
			transactionHash: string | null
			data: string[]
		} | null
	}
	sequencer: {
		liveUrl: string
		archiveUrl: string
		sequencerPk: string
		bridgeContract: string
		networkState: {
			canonicalMaxBlockHeight: number
			pendingMaxBlockHeight: number
		} | null
		lastCommit: {
			timestamp: string
			timestampIso: string | null
			height: number
			chainStatus: string
			distanceFromMaxBlockHeight: number | null
			transactionHash: string | null
			data: string[]
		} | null
	}
	actionsApi: string
}

export type BridgeStatusSourceSnapshot = {
	sources: BridgeStatusSource[]
	observedCount: number
	submitHash?: string
	submitObserved?: boolean
	observedHashes?: string[]
}

export type BridgeSdkOperation =
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

export type BridgeSdkCallTrace = {
	operation: BridgeSdkOperation
	attempt: number
	startedAt: string
	endedAt: string
	durationMs: number
	success: boolean
	message?: string
	result?: string
}

export type BridgeSdkMethodStat = {
	count: number
	successCount: number
	errorCount: number
	totalDurationMs: number
	lastStartedAt?: string
	lastEndedAt?: string
	lastDurationMs?: number
	lastMessage?: string
	lastResult?: string
}

export type BridgePhaseTiming = {
	phase: OperationPhase
	startedAt: string
	endedAt?: string
	durationMs: number
}

export type BridgeVerboseDiagnostics = {
	sdkCalls: BridgeSdkCallTrace[]
	sdkMethodStats: Partial<Record<BridgeSdkOperation, BridgeSdkMethodStat>>
	phaseTimings: BridgePhaseTiming[]
	waitReasons?: Partial<
		Record<
			"canFinalizeDeposit" | "canCancelDeposit" | "canFinalizeWithdrawal",
			BridgeCapabilityDiagnostic
		>
	>
}

export type OperationLiveSnapshot = {
	refreshedAt: string
	nextAction: "wait" | "finalize" | "cancel" | "completed" | "cancelled"
	waitingOn?: "submission" | "prior-claims" | "finalization"
	targetIndex?: number
	claimableIndex?: number
	pendingAhead?: number
	canFinalize?: boolean
	canCancel?: boolean
	submitHash?: string
	observedCounts: {
		deposits: number
		withdrawals: number
	}
	statusSources?: Partial<Record<Direction, BridgeStatusSourceSnapshot>>
}

export type StatusResult<T> = {
	success: true
	direction: Direction
	route: `${ChainRef}->${ChainRef}`
	account: string
	count: number
	operations: T[]
}

export type OperationPhase =
	| "initializing"
	| "submitted"
	| "waiting-submission"
	| "waiting-prior-claims"
	| "waiting-finalization"
	| "retrying"
	| "finalizing"
	| "canceling"
	| "completed"
	| "cancelled"
	| "failed"

export type OperationStatus = "running" | "completed" | "cancelled" | "failed"

export type OperationSession = {
	id: string
	status: OperationStatus
	phase: OperationPhase
	route: `${ChainRef}->${ChainRef}`
	direction: Direction
	account: string
	recipient?: string
	amount: string
	logPath: string
	createdAt: string
	updatedAt: string
	timeoutSlots?: number
	lastError?: string
	targetIndex?: number
	pendingFinalizeIndex?: number
	pendingFinalizeSubmittedAt?: string
	pendingCancelMarker?: string
	queueAdvances?: number
	submittedTransactions: Array<{
		action: "submit" | "finalize" | "cancel"
		hash: string
	}>
	finalTransaction?: {
		action: "submit" | "finalize" | "cancel"
		hash: string
		explorerUrl: string
	}
	liveSnapshot?: OperationLiveSnapshot
	verboseDiagnostics?: BridgeVerboseDiagnostics
}
