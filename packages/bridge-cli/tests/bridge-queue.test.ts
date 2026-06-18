import { describe, expect, it } from "vitest"
import {
	analyzeDepositQueue,
	analyzeWithdrawalQueue,
	getSubmitHash
} from "../src/core/bridge-queue"
import type { OperationSession } from "../src/core/types"

const baseSession = (overrides: Partial<OperationSession> = {}): OperationSession => ({
	id: "op-1",
	status: "running",
	phase: "submitted",
	route: "mina:testnet->zeko-m:testnet",
	direction: "deposit",
	account: "B62test",
	recipient: "B62test",
	amount: "1",
	logPath: "/tmp/op-1.jsonl",
	createdAt: "2026-03-11T00:00:00.000Z",
	updatedAt: "2026-03-11T00:00:00.000Z",
	submittedTransactions: [{ action: "submit", hash: "submit-current" }],
	...overrides
})

describe("bridge queue analysis", () => {
	it("binds the target deposit to the submitted hash and counts pending items ahead of it", () => {
		const session = baseSession()
		const result = analyzeDepositQueue({
			session,
			statuses: [
				{
					index: 4,
					amount: "2",
					recipient: "B62older",
					cancelled: false,
					synced: true,
					accepted: true,
					confirmed: true,
					finalised: false,
					hash: "submit-older",
					timestamp: "2026-03-10T00:00:00.000Z"
				},
				{
					index: 5,
					amount: "1",
					recipient: "B62test",
					cancelled: false,
					synced: true,
					accepted: true,
					confirmed: true,
					finalised: false,
					hash: "submit-current",
					timestamp: "2026-03-10T00:01:00.000Z"
				}
			]
		})

		expect(getSubmitHash(session)).toBe("submit-current")
		expect(result.targetIndex).toBe(5)
		expect(result.claimableIndex).toBe(4)
		expect(result.pendingAhead).toBe(1)
		expect(result.blockingAhead).toBe(1)
		expect(result.skippableAhead).toBe(0)
		expect(result.shouldAdvanceQueuedClaims).toBe(true)
	})

	it("treats earlier cancellable deposits as skippable instead of hard blockers", () => {
		const session = baseSession()
		const result = analyzeDepositQueue({
			session,
			statuses: [
				{
					index: 4,
					amount: "2",
					recipient: "B62older",
					cancelled: false,
					cancellable: true,
					synced: true,
					accepted: false,
					confirmed: false,
					finalised: false,
					hash: "submit-older",
					timestamp: "2026-03-10T00:00:00.000Z"
				},
				{
					index: 5,
					amount: "1",
					recipient: "B62test",
					cancelled: false,
					cancellable: false,
					synced: true,
					accepted: true,
					confirmed: true,
					finalised: false,
					hash: "submit-current",
					timestamp: "2026-03-10T00:01:00.000Z"
				}
			]
		})

		expect(result.pendingAhead).toBe(1)
		expect(result.blockingAhead).toBe(0)
		expect(result.skippableAhead).toBe(1)
		expect(result.claimableIndex).toBe(5)
		expect(result.shouldAdvanceQueuedClaims).toBe(true)
	})

	it("treats an unseen submitted withdrawal as waiting for submission instead of rebinding to another item", () => {
		const session = baseSession({
			route: "zeko-m:testnet->mina:testnet",
			direction: "withdrawal"
		})
		const result = analyzeWithdrawalQueue({
			session,
			statuses: [
				{
					index: 8,
					amount: "1",
					recipient: "B62other",
					committed: true,
					finalised: false,
					hash: "withdraw-older",
					timestamp: "2026-03-10T00:00:00.000Z"
				}
			]
		})

		expect(result.target).toBeUndefined()
		expect(result.targetIndex).toBeUndefined()
		expect(result.claimableIndex).toBe(8)
		expect(result.pendingAhead).toBe(0)
		expect(result.shouldAdvanceQueuedClaims).toBe(true)
	})

	it("keeps a previously observed deposit target index when the status hash changes after finalization", () => {
		const session = baseSession({ targetIndex: 5 })
		const result = analyzeDepositQueue({
			session,
			statuses: [
				{
					index: 4,
					amount: "2",
					recipient: "B62older",
					cancelled: false,
					synced: true,
					accepted: true,
					confirmed: true,
					finalised: true,
					hash: "finalize-older",
					timestamp: "2026-03-10T00:02:00.000Z"
				},
				{
					index: 5,
					amount: "1",
					recipient: "B62test",
					cancelled: false,
					synced: true,
					accepted: true,
					confirmed: true,
					finalised: true,
					hash: "finalize-current",
					timestamp: "2026-03-10T00:03:00.000Z"
				}
			]
		})

		expect(result.target?.index).toBe(5)
		expect(result.targetIndex).toBe(5)
		expect(result.pendingAhead).toBe(0)
		expect(result.shouldAdvanceQueuedClaims).toBe(false)
	})

	it("treats an unseen submitted deposit as waiting for submission instead of rebinding to an older same-amount item", () => {
		const session = baseSession()
		const result = analyzeDepositQueue({
			session,
			statuses: [
				{
					index: 8,
					amount: "1",
					recipient: "B62test",
					cancelled: false,
					synced: true,
					accepted: true,
					confirmed: true,
					finalised: true,
					hash: "older-same-amount",
					timestamp: "2026-03-10T00:00:00.000Z"
				}
			]
		})

		expect(result.target).toBeUndefined()
		expect(result.targetIndex).toBeUndefined()
		expect(result.claimableIndex).toBeUndefined()
		expect(result.pendingAhead).toBe(0)
		expect(result.shouldAdvanceQueuedClaims).toBe(false)
	})

	it("treats an unseen submitted withdrawal as waiting for submission instead of rebinding to an older same-amount item", () => {
		const session = baseSession({
			route: "zeko-m:testnet->mina:testnet",
			direction: "withdrawal"
		})
		const result = analyzeWithdrawalQueue({
			session,
			statuses: [
				{
					index: 8,
					amount: "1",
					recipient: "B62test",
					committed: true,
					finalised: true,
					hash: "older-same-amount",
					timestamp: "2026-03-10T00:00:00.000Z"
				}
			]
		})

		expect(result.target).toBeUndefined()
		expect(result.targetIndex).toBeUndefined()
		expect(result.claimableIndex).toBeUndefined()
		expect(result.pendingAhead).toBe(0)
		expect(result.shouldAdvanceQueuedClaims).toBe(false)
	})
})
