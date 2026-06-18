import { describe, expect, it } from "vitest"
import { createResumeQueue, projectOperationStatus } from "../src/core/operation-services"
import type { DepositStatus, OperationSession, WithdrawalStatus } from "../src/core/types"

const session = {
	id: "op-service",
	status: "running",
	phase: "submitted",
	route: "mina:testnet->zeko-m:testnet",
	direction: "deposit",
	account: "B62account",
	recipient: "B62recipient",
	amount: "2",
	logPath: "/tmp/op-service.jsonl",
	createdAt: "2026-03-10T00:00:00.000Z",
	updatedAt: "2026-03-10T00:00:00.000Z",
	submittedTransactions: [{ action: "submit", hash: "deposit-hash" }],
	liveSnapshot: {
		refreshedAt: "2026-03-10T00:00:10.000Z",
		nextAction: "finalize",
		waitingOn: "finalization",
		targetIndex: 0,
		claimableIndex: 0,
		pendingAhead: 0,
		canFinalize: true,
		canCancel: false,
		submitHash: "deposit-hash",
		observedCounts: { deposits: 1, withdrawals: 0 }
	}
} satisfies OperationSession

const deposit = (input: Partial<DepositStatus> & Pick<DepositStatus, "index">): DepositStatus => ({
	index: input.index,
	amount: input.amount ?? "2",
	recipient: input.recipient ?? "B62recipient",
	cancelled: input.cancelled ?? false,
	cancellable: input.cancellable,
	synced: input.synced ?? true,
	accepted: input.accepted ?? true,
	confirmed: input.confirmed ?? true,
	finalised: input.finalised ?? false,
	hash: input.hash ?? `deposit-${input.index}`,
	timestamp: input.timestamp ?? "2026-03-10T00:00:00.000Z"
})

const withdrawal = (
	input: Partial<WithdrawalStatus> & Pick<WithdrawalStatus, "index">
): WithdrawalStatus => ({
	index: input.index,
	amount: input.amount ?? "2",
	recipient: input.recipient ?? "B62recipient",
	committed: input.committed ?? true,
	finalised: input.finalised ?? false,
	hash: input.hash ?? `withdrawal-${input.index}`,
	timestamp: input.timestamp ?? "2026-03-10T00:00:00.000Z"
})

describe("operation services", () => {
	it("projects status JSON fields from a live session snapshot", () => {
		expect(projectOperationStatus(session)).toMatchObject({
			id: "op-service",
			status: "running",
			phase: "ready-finalization",
			route: "mina:testnet->zeko-m:testnet",
			direction: "deposit",
			account: "B62account",
			recipient: "B62recipient",
			amount: "2",
			log_path: "/tmp/op-service.jsonl",
			refreshed_at: "2026-03-10T00:00:10.000Z",
			target_index: 0,
			claimable_index: 0,
			pending_ahead: 0,
			can_finalize: true,
			can_cancel: false,
			submit_hash: "deposit-hash",
			next_action: "finalize",
			waiting_on: "finalization",
			error: null
		})
	})

	it("prioritizes withdrawal queues for withdrawal routes and matches persisted sessions by hash", () => {
		const persisted: OperationSession = {
			...session,
			id: "existing-withdrawal",
			direction: "withdrawal",
			route: "zeko-m:testnet->mina:testnet",
			submittedTransactions: [{ action: "submit", hash: "withdrawal-0" }]
		}

		const queue = createResumeQueue({
			from: "zeko-m:testnet",
			to: "mina:testnet",
			account: "B62account",
			persistedSessions: [persisted],
			depositStatuses: [deposit({ index: 0, hash: "deposit-0" })],
			withdrawalStatuses: [withdrawal({ index: 0, hash: "withdrawal-0" })]
		})

		expect(queue.map((item) => item.direction)).toEqual(["withdrawal", "deposit"])
		expect(queue[0]?.session?.id).toBe("existing-withdrawal")
	})

	it("matches persisted sessions with legacy route IDs during resume queue creation", () => {
		const persisted: OperationSession = {
			...session,
			id: "legacy-deposit",
			route: "mina:testnet->zeko:testnet"
		} as unknown as OperationSession

		const queue = createResumeQueue({
			from: "mina:testnet",
			to: "zeko-m:testnet",
			account: "B62account",
			persistedSessions: [persisted],
			depositStatuses: [deposit({ index: 0, hash: "deposit-hash" })],
			withdrawalStatuses: []
		})

		expect(queue[0]?.session?.id).toBe("legacy-deposit")
	})

	it("does not match persisted sessions from another account", () => {
		const persisted: OperationSession = {
			...session,
			id: "wrong-account-withdrawal",
			account: "B62other",
			direction: "withdrawal",
			route: "zeko-m:testnet->mina:testnet",
			submittedTransactions: [{ action: "submit", hash: "withdrawal-0" }]
		}

		const queue = createResumeQueue({
			from: "zeko-m:testnet",
			to: "mina:testnet",
			account: "B62account",
			persistedSessions: [persisted],
			depositStatuses: [],
			withdrawalStatuses: [withdrawal({ index: 0, hash: "withdrawal-0" })]
		})

		expect(queue[0]?.session).toBeUndefined()
	})
})
