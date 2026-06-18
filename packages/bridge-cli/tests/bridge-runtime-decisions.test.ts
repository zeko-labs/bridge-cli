import { describe, expect, it } from "vitest"
import {
	decideDepositStep,
	decideWithdrawalStep,
	type BridgeRuntimeDecision
} from "../src/core/bridge-runtime/decisions"
import type { DepositStatus, OperationSession, WithdrawalStatus } from "../src/core/types"

const baseSession = {
	id: "op-1",
	status: "running",
	phase: "submitted",
	route: "mina:testnet->zeko-m:testnet",
	direction: "deposit",
	account: "B62account",
	recipient: "B62recipient",
	amount: "2",
	logPath: "/tmp/op-1.jsonl",
	createdAt: "2026-03-10T00:00:00.000Z",
	updatedAt: "2026-03-10T00:00:00.000Z",
	submittedTransactions: []
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

const expectAction = (decision: BridgeRuntimeDecision, action: BridgeRuntimeDecision["action"]) => {
	expect(decision.action).toBe(action)
	return decision
}

describe("bridge runtime decisions", () => {
	it("submits a deposit when no unresolved deposit exists before a submit hash is known", () => {
		const decision = decideDepositStep({
			session: baseSession,
			statuses: [],
			canFinalize: { available: false, reason: "not ready" },
			canCancel: { available: false, reason: "not ready" }
		})

		expectAction(decision, "submit")
	})

	it("waits for deposit submission visibility after a submit hash is known", () => {
		const decision = decideDepositStep({
			session: {
				...baseSession,
				submittedTransactions: [{ action: "submit", hash: "deposit-submit" }]
			},
			statuses: [],
			canFinalize: { available: false, reason: "not ready" },
			canCancel: { available: false, reason: "not ready" }
		})

		expectAction(decision, "wait")
		expect(decision.phaseEvent).toBe("MARK_WAITING_SUBMISSION")
	})

	it("finalizes a claimable deposit through the SDK when no prior blocking deposit remains", () => {
		const decision = decideDepositStep({
			session: {
				...baseSession,
				submittedTransactions: [{ action: "submit", hash: "deposit-submit" }]
			},
			statuses: [deposit({ index: 0, hash: "deposit-submit" })],
			canFinalize: { available: true, reason: null, index: 0 },
			canCancel: { available: false, reason: "not ready" }
		})

		expectAction(decision, "finalize")
		expect(decision.claimableIndex).toBe(0)
	})

	it("cancels a skippable older deposit before finalizing a later target", () => {
		const decision = decideDepositStep({
			session: {
				...baseSession,
				targetIndex: 1,
				submittedTransactions: [{ action: "submit", hash: "deposit-submit" }]
			},
			statuses: [
				deposit({ index: 0, cancellable: true, confirmed: false }),
				deposit({ index: 1, hash: "deposit-submit" })
			],
			canFinalize: { available: false, reason: "blocked", index: 1 },
			canCancel: { available: true, reason: null, index: 0 }
		})

		expectAction(decision, "cancel")
	})

	it("completes a finalized deposit target", () => {
		const decision = decideDepositStep({
			session: {
				...baseSession,
				submittedTransactions: [{ action: "submit", hash: "deposit-submit" }]
			},
			statuses: [deposit({ index: 0, hash: "deposit-submit", finalised: true })],
			canFinalize: { available: false, reason: "already done" },
			canCancel: { available: false, reason: "not ready" }
		})

		expectAction(decision, "complete")
	})

	it("waits for withdrawal commit before checking finalization", () => {
		const decision = decideWithdrawalStep({
			session: {
				...baseSession,
				direction: "withdrawal",
				route: "zeko-m:testnet->mina:testnet",
				submittedTransactions: [{ action: "submit", hash: "withdrawal-submit" }]
			},
			statuses: [withdrawal({ index: 0, hash: "withdrawal-submit", committed: false })],
			canFinalize: { available: false, reason: "not ready" }
		})

		expectAction(decision, "wait")
		expect(decision.phaseEvent).toBe("MARK_WAITING_SUBMISSION")
	})

	it("finalizes a claimable withdrawal", () => {
		const decision = decideWithdrawalStep({
			session: {
				...baseSession,
				direction: "withdrawal",
				route: "zeko-m:testnet->mina:testnet",
				submittedTransactions: [{ action: "submit", hash: "withdrawal-submit" }]
			},
			statuses: [withdrawal({ index: 0, hash: "withdrawal-submit", committed: true })],
			canFinalize: { available: true, reason: null, index: 0 }
		})

		expectAction(decision, "finalize")
		expect(decision.claimableIndex).toBe(0)
	})

	it("does not complete a withdrawal from an already-finalised diagnostic for another index", () => {
		const decision = decideWithdrawalStep({
			session: {
				...baseSession,
				direction: "withdrawal",
				route: "zeko-m:testnet->mina:testnet",
				submittedTransactions: [{ action: "submit", hash: "withdrawal-submit" }]
			},
			statuses: [withdrawal({ index: 1, hash: "withdrawal-submit", committed: true })],
			canFinalize: {
				available: false,
				reason: "Withdrawal already finalised",
				status: "alreadyFinalised",
				index: 0
			}
		})

		expectAction(decision, "wait")
	})
})
