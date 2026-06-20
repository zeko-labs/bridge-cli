import { describe, expect, it } from "vitest"
import { runBridgeOperation } from "../src/commands/bridge"

describe("bridge flow", () => {
	it("lets the SDK finalize the next available deposit even when status flags lag", async () => {
		let depositStatusCalls = 0
		let submitCalls = 0
		const finalizeCalls: string[] = []

		const result = await runBridgeOperation(
			{
				id: "op-sdk-driven-finalize",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62test",
				timeoutSlots: 10
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: true
						}
					},
					async getDepositStatuses() {
						depositStatusCalls += 1
						if (submitCalls === 0) {
							return []
						}

						return [
							{
								index: 5,
								amount: "2",
								recipient: "B62test",
								cancelled: false,
								synced: true,
								accepted: depositStatusCalls > 1,
								confirmed: depositStatusCalls > 1,
								finalised: finalizeCalls.length > 0,
								hash:
									depositStatusCalls > 1 && finalizeCalls.length > 0
										? "finalize-current"
										: "submit-current",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return { available: true, reason: null }
					},
					async canCancelDeposit() {
						return { available: false, reason: "No cancellable deposit found" }
					},
					async finalizeDeposit() {
						finalizeCalls.push("finalize-current")
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: "finalize-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/finalize-current",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					throw new Error("the CLI should not wait when the SDK reports finalization available")
				},
				pollIntervalMs: 0
			}
		)

		expect(finalizeCalls).toEqual(["finalize-current"])
		expect(result.status).toBe("completed")
	})

	it("does not resubmit SDK-selected prior deposit finalization while status lags", async () => {
		let submitCalls = 0
		let finalizeCalls = 0
		let sleepCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-sdk-selected-prior-deposit",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62test",
				timeoutSlots: 10
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: true
						}
					},
					async getDepositStatuses() {
						if (submitCalls === 0) return []

						if (finalizeCalls === 0 || sleepCalls < 2) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62test",
									cancelled: false,
									cancellable: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "submit-prior",
									timestamp: "2026-03-09T19:00:00.000Z"
								},
								{
									index: 1,
									amount: "2",
									recipient: "B62test",
									cancelled: false,
									cancellable: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "1",
								recipient: "B62test",
								cancelled: false,
								cancellable: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "finalize-prior",
								timestamp: "2026-03-09T19:02:00.000Z"
							},
							{
								index: 1,
								amount: "2",
								recipient: "B62test",
								cancelled: false,
								cancellable: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "finalize-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return { available: true, reason: null, index: 0 }
					},
					async canCancelDeposit() {
						return { available: false, reason: "No cancellable deposit found" }
					},
					async finalizeDeposit() {
						finalizeCalls += 1
						if (finalizeCalls > 1) {
							throw new Error("duplicate prior deposit finalization")
						}

						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: "finalize-prior",
							explorerUrl: "https://zekoscan.io/testnet/tx/finalize-prior",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					sleepCalls += 1
				},
				pollIntervalMs: 0,
				now: () => "2026-03-10T00:00:00.000Z"
			}
		)

		expect(finalizeCalls).toBe(1)
		expect(result.status).toBe("completed")
	})

	it("clears a single queued deposit before submitting a new deposit", async () => {
		let depositStatusCalls = 0
		let nowCalls = 0
		let sleepCalls = 0
		const finalizeCalls: string[] = []
		const callOrder: string[] = []
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []
		const times = [
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:01.000Z",
			"2026-03-10T00:00:01.000Z"
		]

		const result = await runBridgeOperation(
			{
				id: "op-drain-before-submit-visible",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62test",
				timeoutSlots: 10
			},
			{
				adapter: {
					async submitDeposit() {
						throw new Error("bridge flow should clear the queued deposit without submitting")
					},
					async getDepositStatuses() {
						depositStatusCalls += 1

						if (finalizeCalls.length === 0) {
							return [
								{
									index: 4,
									amount: "1",
									recipient: "B62older",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "submit-older",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						return [
							{
								index: 4,
								amount: "1",
								recipient: "B62older",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "finalize-older",
								timestamp: "2026-03-09T19:00:30.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async finalizeDeposit() {
						const hash = "finalize-older"
						finalizeCalls.push(hash)
						callOrder.push(hash)
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash,
							explorerUrl: `https://zekoscan.io/testnet/tx/${hash}`,
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {
					sleepCalls += 1
					if (sleepCalls > 3) {
						throw new Error("bridge flow should not keep waiting after clearing one deposit")
					}
				},
				pollIntervalMs: 0,
				now: () => times[Math.min(nowCalls++, times.length - 1)] ?? times.at(-1) ?? ""
			}
		)

		expect(depositStatusCalls).toBeGreaterThanOrEqual(2)
		expect(finalizeCalls).toEqual(["finalize-older"])
		expect(callOrder).toEqual(["finalize-older"])
		expect(events.some((entry) => entry.event === "submitted")).toBe(false)
		expect(result.lastError).toBeUndefined()
		expect(result.status).toBe("completed")
		expect(result.finalTransaction?.hash).toBe("finalize-older")
	})

	it("advances earlier queued deposit claims before completing the current bridge", async () => {
		let _depositStatusCalls = 0
		let submitCalls = 0
		const finalizeCalls: string[] = []
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-queued",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62test",
				timeoutSlots: 10
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: true
						}
					},
					async getDepositStatuses() {
						_depositStatusCalls += 1
						if (submitCalls === 0 && finalizeCalls.length === 0) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "submit-earlier",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						if (submitCalls === 0) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: true,
									hash: "finalize-earlier",
									timestamp: "2026-03-09T19:02:00.000Z"
								}
							]
						}

						if (finalizeCalls.length === 1) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: true,
									hash: "finalize-earlier",
									timestamp: "2026-03-09T19:02:00.000Z"
								},
								{
									index: 1,
									amount: "2",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "1",
								recipient: "B62test",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "finalize-earlier",
								timestamp: "2026-03-09T19:02:00.000Z"
							},
							{
								index: 1,
								amount: "2",
								recipient: "B62test",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "finalize-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async finalizeDeposit() {
						const hash = submitCalls === 0 ? "finalize-earlier" : "finalize-current"
						finalizeCalls.push(hash)
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash,
							explorerUrl: `https://zekoscan.io/testnet/tx/${hash}`,
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () => "2026-03-09T19:30:00.000Z"
			}
		)

		expect(finalizeCalls).toEqual(["finalize-earlier"])
		expect(events.some((entry) => entry.event === "submitted")).toBe(false)
		expect(result.finalTransaction?.hash).toBe("finalize-earlier")
		expect(result.status).toBe("completed")
	})

	it("retries recoverable deposit finalization proof failures before completing", async () => {
		let _depositStatusCalls = 0
		let submitCalls = 0
		let finalizeAttempts = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-finalize-retry",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62retry"
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "deposit-submit-retry",
							explorerUrl: "https://minascan.io/devnet/tx/deposit-submit-retry",
							included: true
						}
					},
					async getDepositStatuses() {
						_depositStatusCalls += 1
						if (submitCalls === 0) {
							return []
						}

						if (finalizeAttempts === 0) {
							return [
								{
									index: 0,
									amount: "2",
									recipient: "B62retry",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "deposit-submit-retry",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "2",
								recipient: "B62retry",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "deposit-finalize-retry",
								timestamp: "2026-03-09T19:02:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async finalizeDeposit() {
						finalizeAttempts += 1
						if (finalizeAttempts === 1) {
							throw new Error("Failed to fetch proved forest")
						}

						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: "deposit-finalize-retry",
							explorerUrl: "https://zekoscan.io/testnet/tx/deposit-finalize-retry",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () => "2026-03-09T19:30:00.000Z"
			}
		)

		expect(result.status).toBe("completed")
		expect(finalizeAttempts).toBe(2)
		expect(
			events.some(
				(entry) =>
					entry.event === "retrying" &&
					entry.details?.operation === "finalizeDeposit" &&
					entry.details?.message === "Failed to fetch proved forest"
			)
		).toBe(true)
	})

	it("treats invalid key as a terminal deposit finalization failure", async () => {
		let submitCalls = 0
		let finalizeAttempts = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-deposit-invalid-key",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62invalid"
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "deposit-submit-invalid-key",
							explorerUrl: "https://minascan.io/devnet/tx/deposit-submit-invalid-key",
							included: true
						}
					},
					async getDepositStatuses() {
						if (submitCalls === 0) {
							return []
						}

						return [
							{
								index: 0,
								amount: "2",
								recipient: "B62invalid",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: false,
								hash: "deposit-submit-invalid-key",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async finalizeDeposit() {
						finalizeAttempts += 1
						throw new Error("[GraphQL] Invalid key")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("failed")
		expect(result.lastError).toBe("[GraphQL] Invalid key")
		expect(finalizeAttempts).toBe(1)
		expect(events.some((entry) => entry.event === "retrying")).toBe(false)
	})

	it.skip("keeps waiting when a queued deposit looks claimable before witnesses are ready", async () => {
		let depositStatusCalls = 0
		let finalizeAttempts = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-deposit-claim-pending",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62claim"
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "deposit-submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/deposit-submit-current",
							included: false
						}
					},
					async getDepositStatuses() {
						depositStatusCalls += 1

						if (depositStatusCalls === 1) {
							return [
								{
									index: 4,
									amount: "2",
									recipient: "B62claim",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "deposit-submit-older",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						if (depositStatusCalls === 2) {
							return [
								{
									index: 4,
									amount: "2",
									recipient: "B62claim",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "deposit-submit-older",
									timestamp: "2026-03-09T19:00:00.000Z"
								},
								{
									index: 5,
									amount: "1",
									recipient: "B62claim",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "deposit-submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 4,
								amount: "2",
								recipient: "B62claim",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "deposit-finalize-older",
								timestamp: "2026-03-09T19:02:00.000Z"
							},
							{
								index: 5,
								amount: "1",
								recipient: "B62claim",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "deposit-finalize-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async finalizeDeposit() {
						finalizeAttempts += 1
						if (finalizeAttempts === 1) {
							throw new Error("Did not find any deposit to finalize")
						}

						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: "deposit-finalize-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/deposit-finalize-current",
							included: false
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () => "2026-03-09T19:30:00.000Z"
			}
		)

		expect(result.status).toBe("completed")
		expect(finalizeAttempts).toBe(2)
		expect(
			events.some(
				(entry) =>
					entry.event === "claim-pending" &&
					entry.details?.message === "Did not find any deposit to finalize"
			)
		).toBe(true)
	})

	it.skip("rebinds a persisted target index to the submitted hash when the new operation appears later", async () => {
		let depositStatusCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-rebind",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62test",
				session: {
					id: "op-rebind",
					status: "running",
					phase: "waiting-finalization",
					route: "mina:testnet->zeko-m:testnet",
					direction: "deposit",
					account: "B62test",
					recipient: "B62test",
					amount: "1",
					logPath: "/tmp/rebind.jsonl",
					createdAt: "2026-03-10T00:00:00.000Z",
					updatedAt: "2026-03-10T00:00:10.000Z",
					submittedTransactions: [{ action: "submit", hash: "submit-current" }],
					targetIndex: 5
				}
			},
			{
				adapter: {
					async getDepositStatuses() {
						depositStatusCalls += 1
						if (depositStatusCalls === 1) {
							return [
								{
									index: 5,
									amount: "2",
									recipient: "B62other",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "older-pending",
									timestamp: "2026-03-09T19:00:00.000Z"
								},
								{
									index: 7,
									amount: "1",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 5,
								amount: "2",
								recipient: "B62other",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "older-finalized",
								timestamp: "2026-03-09T19:02:00.000Z"
							},
							{
								index: 7,
								amount: "1",
								recipient: "B62test",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "finalize-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async finalizeDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: "finalize-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/finalize-current",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () => "2026-03-10T00:00:00.000Z"
			}
		)

		expect(result.targetIndex).toBe(7)
		expect(result.status).toBe("completed")
	})

	it("cancels an older skippable deposit before completing the requested bridge", async () => {
		let depositStatusCalls = 0
		let submitCalls = 0
		let finalizeAttempts = 0
		const cancelCalls: string[] = []
		const finalizeCalls: string[] = []
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-prior-cancel",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62test",
				timeoutSlots: 10
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: true
						}
					},
					async getDepositStatuses() {
						depositStatusCalls += 1
						if (submitCalls === 0 && cancelCalls.length === 0) {
							return [
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
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						if (submitCalls === 0) {
							return [
								{
									index: 4,
									amount: "2",
									recipient: "B62older",
									cancelled: true,
									cancellable: false,
									synced: true,
									accepted: false,
									confirmed: false,
									finalised: false,
									hash: "cancel-older",
									timestamp: "2026-03-09T19:02:00.000Z"
								}
							]
						}

						if (finalizeCalls.length === 0) {
							return [
								{
									index: 4,
									amount: "2",
									recipient: "B62older",
									cancelled: true,
									cancellable: false,
									synced: true,
									accepted: false,
									confirmed: false,
									finalised: false,
									hash: "cancel-older",
									timestamp: "2026-03-09T19:02:00.000Z"
								},
								{
									index: 5,
									amount: "1",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 4,
								amount: "2",
								recipient: "B62older",
								cancelled: true,
								cancellable: false,
								synced: true,
								accepted: false,
								confirmed: false,
								finalised: false,
								hash: "cancel-older",
								timestamp: "2026-03-09T19:02:00.000Z"
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
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return depositStatusCalls >= 2
					},
					async canCancelDeposit() {
						return true
					},
					async cancelDeposit() {
						cancelCalls.push("cancel-older")
						return {
							success: true,
							direction: "deposit",
							action: "cancel",
							route: "mina:testnet->zeko-m:testnet",
							hash: "cancel-older",
							explorerUrl: "https://minascan.io/devnet/tx/cancel-older",
							included: true
						}
					},
					async finalizeDeposit() {
						finalizeAttempts += 1
						if (finalizeAttempts === 1) {
							throw new Error("Did not find any deposit to finalize")
						}

						finalizeCalls.push("finalize-current")
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: "finalize-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/finalize-current",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0
			}
		)

		expect(cancelCalls).toEqual(["cancel-older"])
		expect(finalizeCalls).toEqual(["finalize-current"])
		expect(events.some((entry) => entry.event === "submitted")).toBe(true)
		expect(result.finalTransaction?.hash).toBe("finalize-current")
		expect(result.status).toBe("completed")
	})

	it("prefers canceling an older skippable deposit before finalizing a later claimable target", async () => {
		let _depositStatusCalls = 0
		let submitCalls = 0
		const calls: string[] = []

		const result = await runBridgeOperation(
			{
				id: "op-cancel-before-finalize",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62test"
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: true
						}
					},
					async getDepositStatuses() {
						_depositStatusCalls += 1

						if (submitCalls === 0 && !calls.includes("cancel")) {
							return [
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
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						if (submitCalls === 0) {
							return [
								{
									index: 4,
									amount: "2",
									recipient: "B62older",
									cancelled: true,
									cancellable: false,
									synced: true,
									accepted: false,
									confirmed: false,
									finalised: false,
									hash: "cancel-older",
									timestamp: "2026-03-09T19:02:00.000Z"
								}
							]
						}

						if (!calls.includes("finalize")) {
							return [
								{
									index: 4,
									amount: "2",
									recipient: "B62older",
									cancelled: true,
									cancellable: false,
									synced: true,
									accepted: false,
									confirmed: false,
									finalised: false,
									hash: "cancel-older",
									timestamp: "2026-03-09T19:02:00.000Z"
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
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 4,
								amount: "2",
								recipient: "B62older",
								cancelled: true,
								cancellable: false,
								synced: true,
								accepted: false,
								confirmed: false,
								finalised: false,
								hash: "cancel-older",
								timestamp: "2026-03-09T19:02:00.000Z"
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
								finalised: true,
								hash: "finalize-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return submitCalls > 0
					},
					async canCancelDeposit() {
						return true
					},
					async cancelDeposit() {
						calls.push("cancel")
						return {
							success: true,
							direction: "deposit",
							action: "cancel",
							route: "mina:testnet->zeko-m:testnet",
							hash: "cancel-older",
							explorerUrl: "https://minascan.io/devnet/tx/cancel-older",
							included: true
						}
					},
					async finalizeDeposit() {
						calls.push("finalize")
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: "finalize-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/finalize-current",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {},
				pollIntervalMs: 0
			}
		)

		expect(calls).toEqual(["cancel", "finalize"])
		expect(result.finalTransaction?.hash).toBe("finalize-current")
		expect(result.status).toBe("completed")
	})

	it.skip("emits low-noise heartbeat progress during long waits", async () => {
		let depositStatusCalls = 0
		let nowIndex = 0
		const times = [
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:30.000Z",
			"2026-03-10T00:01:01.000Z",
			"2026-03-10T00:01:01.000Z",
			"2026-03-10T00:01:01.000Z",
			"2026-03-10T00:01:01.000Z",
			"2026-03-10T00:01:30.000Z",
			"2026-03-10T00:02:02.000Z",
			"2026-03-10T00:02:02.000Z",
			"2026-03-10T00:02:02.000Z"
		]
		const events: string[] = []

		const result = await runBridgeOperation(
			{
				id: "op-heartbeat",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62test",
				timeoutSlots: 10
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-hash",
							explorerUrl: "https://minascan.io/devnet/tx/submit-hash",
							included: true
						}
					},
					async getDepositStatuses() {
						depositStatusCalls += 1
						if (depositStatusCalls < 4) {
							return [
								{
									index: 0,
									amount: "2",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "submit-hash",
									timestamp: "2026-03-10T00:00:01.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "2",
								recipient: "B62test",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "finalize-hash",
								timestamp: "2026-03-10T00:02:02.000Z"
							}
						]
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event }) => {
					events.push(event)
				},
				sleep: async () => {},
				pollIntervalMs: 30_000,
				now: () => times[Math.min(nowIndex++, times.length - 1)] ?? times.at(-1) ?? ""
			}
		)

		expect(events.filter((event) => event === "heartbeat")).toHaveLength(2)
		expect(result.status).toBe("completed")
	})

	it.skip("waits across long withdrawal submission delays without failing", async () => {
		const events: string[] = []
		let nowCalls = 0
		let withdrawalStatusCalls = 0
		const times = [
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T03:00:00.000Z",
			"2026-03-10T03:00:00.000Z",
			"2026-03-10T03:00:01.000Z"
		]

		const result = await runBridgeOperation(
			{
				id: "op-stalled-submission",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "1",
				account: "B62test"
			},
			{
				adapter: {
					async submitWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdraw-submit",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdraw-submit",
							included: false
						}
					},
					async getWithdrawalStatuses() {
						withdrawalStatusCalls += 1

						if (withdrawalStatusCalls === 1) {
							return []
						}

						if (withdrawalStatusCalls === 2) {
							return [
								{
									index: 4,
									amount: "1",
									recipient: "B62test",
									committed: false,
									finalised: false,
									hash: "withdraw-submit",
									timestamp: "2026-03-10T03:00:00.000Z"
								}
							]
						}

						return [
							{
								index: 4,
								amount: "1",
								recipient: "B62test",
								committed: true,
								finalised: true,
								hash: "withdraw-finalize",
								timestamp: "2026-03-10T03:00:01.000Z"
							}
						]
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event }) => {
					events.push(event)
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () => times[Math.min(nowCalls++, times.length - 1)] ?? times.at(-1) ?? ""
			}
		)

		expect(result.status).toBe("completed")
		expect(events).not.toContain("failed")
	})

	it("clears a single queued withdrawal before submitting a new withdrawal", async () => {
		let withdrawalStatusCalls = 0
		let nowCalls = 0
		let sleepCalls = 0
		const finalizeCalls: string[] = []
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []
		const times = [
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T00:00:01.000Z",
			"2026-03-10T00:00:01.000Z"
		]

		const result = await runBridgeOperation(
			{
				id: "op-drain-withdrawals-before-submit-visible",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "2",
				account: "B62test"
			},
			{
				adapter: {
					async submitWithdrawal() {
						throw new Error("bridge flow should clear the queued withdrawal without submitting")
					},
					async getWithdrawalStatuses() {
						withdrawalStatusCalls += 1

						if (finalizeCalls.length === 0) {
							return [
								{
									index: 8,
									amount: "1",
									recipient: "B62older",
									committed: true,
									finalised: false,
									hash: "withdraw-submit-older",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						return [
							{
								index: 8,
								amount: "1",
								recipient: "B62older",
								committed: true,
								finalised: true,
								hash: "withdraw-finalize-older",
								timestamp: "2026-03-09T19:00:30.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						return true
					},
					async finalizeWithdrawal() {
						const hash = "withdraw-finalize-older"
						finalizeCalls.push(hash)
						return {
							success: true,
							direction: "withdrawal",
							action: "finalize",
							route: "zeko-m:testnet->mina:testnet",
							hash,
							explorerUrl: `https://minascan.io/devnet/tx/${hash}`,
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {
					sleepCalls += 1
					if (sleepCalls > 3) {
						throw new Error("bridge flow should not keep waiting after clearing one withdrawal")
					}
				},
				pollIntervalMs: 0,
				now: () => times[Math.min(nowCalls++, times.length - 1)] ?? times.at(-1) ?? ""
			}
		)

		expect(withdrawalStatusCalls).toBeGreaterThanOrEqual(2)
		expect(finalizeCalls).toEqual(["withdraw-finalize-older"])
		expect(events.some((entry) => entry.event === "submitted")).toBe(false)
		expect(result.lastError).toBeUndefined()
		expect(result.status).toBe("completed")
		expect(result.finalTransaction?.hash).toBe("withdraw-finalize-older")
	})

	it("completes when the SDK reports the target withdrawal is already finalised", async () => {
		let submitCalls = 0
		let finalizeCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-withdrawal-already-finalised",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "3",
				account: "B62test"
			},
			{
				adapter: {
					async submitWithdrawal() {
						submitCalls += 1
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdraw-submit-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdraw-submit-current",
							included: true
						}
					},
					async getWithdrawalStatuses() {
						if (submitCalls === 0) return []

						return [
							{
								index: 9,
								amount: "3",
								recipient: "B62test",
								committed: true,
								finalised: false,
								hash: "withdraw-submit-current",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						return {
							available: false,
							reason: "Withdrawal already finalised",
							status: "alreadyFinalised",
							index: 9
						}
					},
					async finalizeWithdrawal() {
						finalizeCalls += 1
						throw new Error("already-finalised withdrawal should not be finalized again")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					throw new Error("already-finalised withdrawal should complete instead of waiting")
				},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("completed")
		expect(result.finalTransaction?.hash).toBe("withdraw-submit-current")
		expect(finalizeCalls).toBe(0)
	})

	it("does not resubmit withdrawal finalization while status lags after a finalization hash", async () => {
		let submitCalls = 0
		let statusCalls = 0
		let finalizeCalls = 0
		let sleepCalls = 0
		let nowMs = Date.parse("2026-03-09T19:01:00.000Z")

		const result = await runBridgeOperation(
			{
				id: "op-withdrawal-finalize-status-lag",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "1.9",
				account: "B62test"
			},
			{
				adapter: {
					async submitWithdrawal() {
						submitCalls += 1
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdraw-submit-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdraw-submit-current",
							included: true
						}
					},
					async getWithdrawalStatuses() {
						statusCalls += 1
						if (submitCalls === 0) return []

						const statusLaggingAfterFinalize = finalizeCalls > 0 && statusCalls < 4
						return [
							{
								index: 9,
								amount: "1.9",
								recipient: "B62test",
								committed: true,
								finalised: finalizeCalls > 0 && !statusLaggingAfterFinalize,
								hash:
									finalizeCalls > 0 && !statusLaggingAfterFinalize
										? "withdraw-finalize-current"
										: "withdraw-submit-current",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						return { available: true, reason: null, index: 9 }
					},
					async finalizeWithdrawal() {
						finalizeCalls += 1
						return {
							success: true,
							direction: "withdrawal",
							action: "finalize",
							route: "zeko-m:testnet->mina:testnet",
							hash: `withdraw-finalize-current-${finalizeCalls}`,
							explorerUrl: `https://minascan.io/devnet/tx/withdraw-finalize-current-${finalizeCalls}`,
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					sleepCalls += 1
					nowMs += 181_000
				},
				pollIntervalMs: 0,
				now: () => new Date(nowMs).toISOString()
			}
		)

		expect(result.status).toBe("completed")
		expect(finalizeCalls).toBe(1)
		expect(sleepCalls).toBeGreaterThanOrEqual(1)
		expect(result.finalTransaction?.hash).toBe("withdraw-finalize-current-1")
	})

	it("does not complete the target withdrawal from an already-finalised result for a different index", async () => {
		let submitCalls = 0
		let statusCalls = 0
		let sleepCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-withdrawal-already-finalised-other-index",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "3",
				account: "B62test"
			},
			{
				adapter: {
					async submitWithdrawal() {
						submitCalls += 1
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdraw-submit-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdraw-submit-current",
							included: true
						}
					},
					async getWithdrawalStatuses() {
						statusCalls += 1
						if (submitCalls === 0) return []

						return [
							{
								index: 8,
								amount: "2",
								recipient: "B62test",
								committed: true,
								finalised: true,
								hash: "withdraw-finalize-older",
								timestamp: "2026-03-09T19:00:00.000Z"
							},
							{
								index: 9,
								amount: "3",
								recipient: "B62test",
								committed: true,
								finalised: statusCalls > 1,
								hash: "withdraw-submit-current",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						return {
							available: false,
							reason: "Withdrawal already finalised",
							status: "alreadyFinalised",
							index: 8
						}
					},
					async finalizeWithdrawal() {
						throw new Error("wrong-index already-finalised result should not finalize")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					sleepCalls += 1
				},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("completed")
		expect(result.targetIndex).toBe(9)
		expect(sleepCalls).toBe(0)
	})

	it("waits for a target withdrawal to commit before checking finalization", async () => {
		let submitCalls = 0
		let statusCalls = 0
		let sleepCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-withdrawal-wait-commit-before-finalize-check",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "3",
				account: "B62test"
			},
			{
				adapter: {
					async submitWithdrawal() {
						submitCalls += 1
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdraw-submit-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdraw-submit-current",
							included: true
						}
					},
					async getWithdrawalStatuses() {
						statusCalls += 1
						if (submitCalls === 0) return []

						return [
							{
								index: 9,
								amount: "3",
								recipient: "B62test",
								committed: statusCalls > 1,
								finalised: statusCalls > 1,
								hash: "withdraw-submit-current",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						throw new Error("uncommitted target withdrawal should not check finalizability")
					},
					async finalizeWithdrawal() {
						throw new Error("uncommitted target withdrawal should not be finalized")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					sleepCalls += 1
				},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("completed")
		expect(sleepCalls).toBe(0)
	})

	it.skip("waits across long queued deposit delays without failing", async () => {
		const events: string[] = []
		let nowCalls = 0
		let depositStatusCalls = 0
		const times = [
			"2026-03-10T00:00:00.000Z",
			"2026-03-10T03:00:00.000Z",
			"2026-03-10T03:00:00.000Z",
			"2026-03-10T03:00:01.000Z"
		]

		const result = await runBridgeOperation(
			{
				id: "op-stalled-prior",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62test"
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "deposit-submit",
							explorerUrl: "https://minascan.io/devnet/tx/deposit-submit",
							included: false
						}
					},
					async getDepositStatuses() {
						depositStatusCalls += 1

						if (depositStatusCalls === 1) {
							return [
								{
									index: 1,
									amount: "2",
									recipient: "B62older",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "older-submit",
									timestamp: "2026-03-09T19:00:00.000Z"
								},
								{
									index: 2,
									amount: "1",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "deposit-submit",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						if (depositStatusCalls === 2) {
							return [
								{
									index: 1,
									amount: "2",
									recipient: "B62older",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: true,
									hash: "older-finalized",
									timestamp: "2026-03-10T03:00:00.000Z"
								},
								{
									index: 2,
									amount: "1",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "deposit-submit",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 1,
								amount: "2",
								recipient: "B62older",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "older-finalized",
								timestamp: "2026-03-10T03:00:00.000Z"
							},
							{
								index: 2,
								amount: "1",
								recipient: "B62test",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "deposit-finalized",
								timestamp: "2026-03-10T03:00:01.000Z"
							}
						]
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event }) => {
					events.push(event)
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () => times[Math.min(nowCalls++, times.length - 1)] ?? times.at(-1) ?? ""
			}
		)

		expect(result.status).toBe("completed")
		expect(events).toContain("waiting-on-prior-claims")
		expect(events).not.toContain("failed")
	})

	it("submits and finalizes a deposit flow", async () => {
		let depositStatusCalls = 0
		let submitCalls = 0
		let finalizeCalls = 0
		const events: string[] = []
		const waits: boolean[] = []

		const result = await runBridgeOperation(
			{
				id: "op-1",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62test",
				timeoutSlots: 10
			},
			{
				adapter: {
					async submitDeposit({ wait }) {
						submitCalls += 1
						waits.push(wait)
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-hash",
							explorerUrl: "https://minascan.io/devnet/tx/submit-hash",
							included: true
						}
					},
					async getDepositStatuses() {
						depositStatusCalls += 1
						if (submitCalls === 0) {
							return []
						}

						if (finalizeCalls === 0) {
							return [
								{
									index: 0,
									amount: "2",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "submit-hash",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						if (finalizeCalls === 1 && depositStatusCalls === 3) {
							return [
								{
									index: 0,
									amount: "2",
									recipient: "B62test",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "submit-hash",
									timestamp: "2026-03-09T19:00:30.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "2",
								recipient: "B62test",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "finalize-hash",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async finalizeDeposit({ wait }) {
						finalizeCalls += 1
						waits.push(wait)
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: "finalize-hash",
							explorerUrl: "https://zekoscan.io/testnet/tx/finalize-hash",
							included: true
						}
					}
				},
				sessionStore: {
					async save(session) {
						events.push(session.phase)
					}
				},
				log: async ({ event }) => {
					events.push(event)
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				retryDelayMs: 0,
				now: () => "2026-03-09T19:20:00.000Z"
			}
		)

		expect(result.status).toBe("completed")
		expect(result.finalTransaction?.hash).toBe("finalize-hash")
		expect(depositStatusCalls).toBe(4)
		expect(finalizeCalls).toBe(1)
		expect(waits).toEqual([false, false])
		expect(events).toContain("submitted")
		expect(events).toContain("finalized")
	})

	it.skip("retries transient adapter failures instead of aborting the bridge flow", async () => {
		let statusCalls = 0
		const events: string[] = []

		const result = await runBridgeOperation(
			{
				id: "op-retry",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62retry"
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "retry-submit",
							explorerUrl: "https://minascan.io/devnet/tx/retry-submit",
							included: true
						}
					},
					async getDepositStatuses() {
						statusCalls += 1
						if (statusCalls === 1) {
							throw new Error("temporary rpc failure")
						}

						return [
							{
								index: 0,
								amount: "1",
								recipient: "B62retry",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "retry-submit",
								timestamp: "2026-03-09T19:02:00.000Z"
							}
						]
					},
					async finalizeDeposit() {
						throw new Error("finalizeDeposit should not be called in this test")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event }) => {
					events.push(event)
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				retryDelayMs: 0
			}
		)

		expect(result.status).toBe("completed")
		expect(statusCalls).toBe(2)
		expect(events).toContain("retrying")
	})

	it.skip("emits heartbeat progress while waiting for confirmation", async () => {
		let statusCalls = 0
		const events: string[] = []

		const result = await runBridgeOperation(
			{
				id: "op-heartbeat",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62heartbeat"
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "heartbeat-submit",
							explorerUrl: "https://minascan.io/devnet/tx/heartbeat-submit",
							included: true
						}
					},
					async getDepositStatuses() {
						statusCalls += 1
						if (statusCalls === 1) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62heartbeat",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: false,
									finalised: false,
									hash: "heartbeat-submit",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "1",
								recipient: "B62heartbeat",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "heartbeat-finalize",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async finalizeDeposit() {
						throw new Error("finalizeDeposit should not be called in this test")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event }) => {
					events.push(event)
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () => "2026-03-09T19:00:30.000Z"
			}
		)

		expect(result.status).toBe("completed")
		expect(events).toContain("heartbeat")
	})

	it.skip("captures verbose sdk timings and capability reasons during long waits", async () => {
		let statusCalls = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []
		const result = await runBridgeOperation(
			{
				id: "op-verbose-diagnostics",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62verbose"
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "verbose-submit",
							explorerUrl: "https://minascan.io/devnet/tx/verbose-submit",
							included: true
						}
					},
					async getDepositStatuses() {
						statusCalls += 1
						if (statusCalls === 1) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62verbose",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "verbose-submit",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "1",
								recipient: "B62verbose",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "verbose-finalize",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return {
							available: false,
							reason: "No deposit witnesses found"
						}
					},
					async canCancelDeposit() {
						return {
							available: false,
							reason: "Not rejected or accepted"
						}
					},
					async finalizeDeposit() {
						throw new Error("finalizeDeposit should not be called in this test")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () => "2026-03-09T19:00:30.000Z",
				verbose: true
			}
		)

		expect(result.status).toBe("completed")
		expect(result.verboseDiagnostics?.sdkMethodStats.getDepositStatuses?.count).toBe(2)
		expect(result.verboseDiagnostics?.sdkMethodStats.canFinalizeDeposit?.count).toBe(1)
		expect(result.verboseDiagnostics?.waitReasons?.canFinalizeDeposit).toEqual({
			available: false,
			reason: "No deposit witnesses found"
		})
		expect(
			events.some(
				(entry) =>
					entry.event === "heartbeat" &&
					entry.details?.finalizeReason === "No deposit witnesses found"
			)
		).toBe(true)
	})

	it("advances earlier deposit claims before completing the current bridge", async () => {
		let _statusCalls = 0
		let submitCalls = 0
		let finalizeCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-queued-deposit",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62queued"
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "deposit-submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/deposit-submit-current",
							included: true
						}
					},
					async getDepositStatuses() {
						_statusCalls += 1
						if (submitCalls === 0 && finalizeCalls === 0) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62queued",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "deposit-submit-earlier",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						if (submitCalls === 0) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62queued",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: true,
									hash: "deposit-finalize-earlier",
									timestamp: "2026-03-09T19:02:00.000Z"
								}
							]
						}

						if (finalizeCalls === 1) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62queued",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: true,
									hash: "deposit-finalize-earlier",
									timestamp: "2026-03-09T19:02:00.000Z"
								},
								{
									index: 1,
									amount: "2",
									recipient: "B62queued",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "deposit-submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "1",
								recipient: "B62queued",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "deposit-finalize-earlier",
								timestamp: "2026-03-09T19:02:00.000Z"
							},
							{
								index: 1,
								amount: "2",
								recipient: "B62queued",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "deposit-finalize-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async finalizeDeposit() {
						finalizeCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash: submitCalls === 0 ? "deposit-finalize-earlier" : "deposit-finalize-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/deposit-finalize-current",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					throw new Error("bridge flow got stuck waiting instead of advancing queued claims")
				},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("completed")
		expect(finalizeCalls).toBe(1)
		expect(result.finalTransaction?.hash).toBe("deposit-finalize-earlier")
	})

	it("advances earlier withdrawal claims before completing the current bridge", async () => {
		let statusCalls = 0
		let finalizeCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-queued-withdrawal",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "2",
				account: "B62queued"
			},
			{
				adapter: {
					async submitWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdrawal-submit-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdrawal-submit-current",
							included: true
						}
					},
					async getWithdrawalStatuses() {
						statusCalls += 1
						if (statusCalls === 1) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62queued",
									committed: true,
									finalised: false,
									hash: "withdrawal-submit-earlier",
									timestamp: "2026-03-09T19:00:00.000Z"
								},
								{
									index: 1,
									amount: "2",
									recipient: "B62queued",
									committed: true,
									finalised: false,
									hash: "withdrawal-submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}
						if (statusCalls === 2) {
							return [
								{
									index: 0,
									amount: "1",
									recipient: "B62queued",
									committed: true,
									finalised: true,
									hash: "withdrawal-finalize-earlier",
									timestamp: "2026-03-09T19:02:00.000Z"
								},
								{
									index: 1,
									amount: "2",
									recipient: "B62queued",
									committed: true,
									finalised: false,
									hash: "withdrawal-submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 0,
								amount: "1",
								recipient: "B62queued",
								committed: true,
								finalised: true,
								hash: "withdrawal-finalize-earlier",
								timestamp: "2026-03-09T19:02:00.000Z"
							},
							{
								index: 1,
								amount: "2",
								recipient: "B62queued",
								committed: true,
								finalised: true,
								hash: "withdrawal-finalize-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						return true
					},
					async finalizeWithdrawal() {
						finalizeCalls += 1
						return {
							success: true,
							direction: "withdrawal",
							action: "finalize",
							route: "zeko-m:testnet->mina:testnet",
							hash:
								finalizeCalls === 1 ? "withdrawal-finalize-earlier" : "withdrawal-finalize-current",
							explorerUrl: "https://minascan.io/devnet/tx/withdrawal-finalize-current",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					throw new Error("bridge flow got stuck waiting instead of advancing queued claims")
				},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("completed")
		expect(finalizeCalls).toBe(2)
		expect(result.finalTransaction?.hash).toBe("withdrawal-finalize-current")
	})

	it.skip("retries recoverable withdrawal submission proof failures before continuing", async () => {
		let submitAttempts = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-withdrawal-submit-retry",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "3",
				account: "B62submitretry"
			},
			{
				adapter: {
					async submitWithdrawal() {
						submitAttempts += 1
						if (submitAttempts === 1) {
							throw new Error("Failed to fetch proved forest")
						}

						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdrawal-submit-retry",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdrawal-submit-retry",
							included: true
						}
					},
					async getWithdrawalStatuses() {
						return [
							{
								index: 0,
								amount: "3",
								recipient: "B62submitretry",
								committed: true,
								finalised: true,
								hash: "withdrawal-submit-retry",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						return true
					},
					async finalizeWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "finalize",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdrawal-finalize-retry",
							explorerUrl: "https://minascan.io/devnet/tx/withdrawal-finalize-retry",
							included: true
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("completed")
		expect(submitAttempts).toBe(2)
		expect(
			events.some(
				(entry) =>
					entry.event === "retrying" &&
					entry.details?.operation === "submitWithdrawal" &&
					entry.details?.message === "Failed to fetch proved forest"
			)
		).toBe(true)
	})

	it("reports withdrawal status endpoints and submit visibility while waiting", async () => {
		let statusCalls = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-withdrawal-status-diagnostics",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "3",
				account: "B62status"
			},
			{
				adapter: {
					getStatusSources() {
						return {
							withdrawals: [
								{
									name: "l2-archive",
									endpoint: "https://archive.testnet.zeko.io/graphql",
									role: "archived Zeko withdrawal actions"
								},
								{
									name: "l2-live",
									endpoint: "https://testnet.zeko.io/graphql",
									role: "recent live Zeko withdrawal actions"
								}
							]
						}
					},
					async submitWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdrawal-submit-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdrawal-submit-current",
							included: false
						}
					},
					async getWithdrawalStatuses() {
						statusCalls += 1
						if (statusCalls <= 2) return []

						return [
							{
								index: 2,
								amount: "3",
								recipient: "B62status",
								committed: true,
								finalised: true,
								hash: "withdrawal-submit-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						return { available: false, reason: "not ready", status: "waiting" }
					},
					async finalizeWithdrawal() {
						throw new Error("finalizeWithdrawal should not be called")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0
			}
		)

		const waitingEvent = events.find((entry) => entry.event === "waiting-for-submission")
		expect(result.status).toBe("completed")
		expect(waitingEvent?.details).toMatchObject({
			submitHash: "withdrawal-submit-current",
			statusEndpoints:
				"l2-archive=https://archive.testnet.zeko.io/graphql, l2-live=https://testnet.zeko.io/graphql",
			withdrawalStatusCount: 0,
			submitObserved: false
		})
	})

	it("fails clearly during withdrawal submission on a terminal first-withdrawal amount error", async () => {
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []
		const errorMessage =
			"First Zeko->Mina withdrawal amount is too small: recipient B62submitretry does not have an L1 helper account yet, so the first withdrawal must be at least 1 MINA to cover the Mina account creation fee. This withdrawal is 0.2 MINA and cannot proceed as submitted."
		let inspected = false

		const result = await runBridgeOperation(
			{
				id: "op-withdrawal-too-small",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "0.2",
				account: "B62submitretry"
			},
			{
				adapter: {
					async submitWithdrawal() {
						throw new Error(errorMessage)
					},
					async getWithdrawalStatuses() {
						inspected = true
						return []
					},
					async canFinalizeWithdrawal() {
						throw new Error("canFinalizeWithdrawal should not be called")
					},
					async finalizeWithdrawal() {
						throw new Error("finalizeWithdrawal should not be called")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {
					throw new Error("terminal withdrawal amount error should not be retried")
				},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("failed")
		expect(result.lastError).toBe(errorMessage)
		expect(events.some((entry) => entry.event === "retrying")).toBe(false)
		expect(inspected).toBe(true)
	})

	it("stops immediately when submission fails instead of falling through to inspect", async () => {
		let inspections = 0

		const result = await runBridgeOperation(
			{
				id: "op-submit-failure",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "1",
				account: "B62submitfail"
			},
			{
				adapter: {
					async submitDeposit() {
						throw new Error("submit exploded")
					},
					async getDepositStatuses() {
						inspections += 1
						return []
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("failed")
		expect(result.lastError).toBe("submit exploded")
		expect(inspections).toBe(1)
	})

	it("cancels the current deposit when finalize stays unavailable but the SDK marks it cancelable", async () => {
		let statusCalls = 0
		let submitCalls = 0
		let finalizeCalls = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-current-deposit-cancel",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62cancel"
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: false
						}
					},
					async getDepositStatuses() {
						statusCalls += 1
						if (submitCalls === 0) {
							return []
						}

						if (statusCalls === 2) {
							return [
								{
									index: 12,
									amount: "2",
									recipient: "B62cancel",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: false,
									hash: "submit-current",
									timestamp: "2026-03-10T12:00:00.000Z"
								}
							]
						}

						return [
							{
								index: 12,
								amount: "2",
								recipient: "B62cancel",
								cancelled: true,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: false,
								hash: "cancel-current",
								timestamp: "2026-03-10T12:05:00.000Z"
							}
						]
					},
					async finalizeDeposit() {
						finalizeCalls += 1
						throw new Error("Did not find any deposit to finalize")
					},
					async canCancelDeposit() {
						return true
					},
					async cancelDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "cancel",
							route: "mina:testnet->zeko-m:testnet",
							hash: "cancel-current",
							explorerUrl: "https://minascan.io/devnet/tx/cancel-current",
							included: false
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("cancelled")
		expect(result.finalTransaction?.hash).toBe("cancel-current")
		expect(finalizeCalls).toBe(0)
		expect(
			events.some(
				(entry) => entry.event === "cancel-submitted" && entry.details?.hash === "cancel-current"
			)
		).toBe(true)
		expect(events.some((entry) => entry.event === "claim-pending")).toBe(false)
	})

	it("keeps waiting when the deposit cancellation capability check fails", async () => {
		let statusCalls = 0
		let submitCalls = 0
		let canCancelCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-waits-through-cancel-check-failure",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62cancelcheck"
			},
			{
				adapter: {
					async submitDeposit() {
						submitCalls += 1
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: false
						}
					},
					async getDepositStatuses() {
						statusCalls += 1
						if (submitCalls === 0) return []

						return [
							{
								index: 12,
								amount: "2",
								recipient: "B62cancelcheck",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: false,
								hash: "submit-current",
								timestamp: "2026-03-10T12:00:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return {
							available: false,
							reason: "Deposit is not finalizable yet"
						}
					},
					async canCancelDeposit() {
						canCancelCalls += 1
						throw new Error("Error getting account data")
					},
					async cancelDeposit() {
						throw new Error("cancelDeposit should not be called")
					},
					async finalizeDeposit() {
						throw new Error("finalizeDeposit should not be called")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async (ms) => {
					if (ms === 0) {
						throw new Error("stop-after-wait")
					}
				},
				pollIntervalMs: 0,
				retryDelayMs: 1,
				verbose: true
			}
		)

		expect(statusCalls).toBeGreaterThan(1)
		expect(canCancelCalls).toBe(6)
		expect(result.status).toBe("failed")
		expect(result.lastError).toBe("stop-after-wait")
		expect(result.verboseDiagnostics?.waitReasons?.canCancelDeposit).toMatchObject({
			available: false,
			status: "blocked"
		})
		expect(result.verboseDiagnostics?.waitReasons?.canCancelDeposit?.reason).toContain(
			"canCancelDeposit failed after 6 attempts"
		)
	})

	it.skip("keeps waiting when deposit cannot yet finalize or cancel", async () => {
		let statusCalls = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []
		let sleepCalls = 0

		const result = await runBridgeOperation(
			{
				id: "op-waits-without-cancel-ready",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62timeout",
				timeoutSlots: 480
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-pending",
							explorerUrl: "https://minascan.io/devnet/tx/submit-pending",
							included: false
						}
					},
					async getDepositStatuses() {
						statusCalls += 1
						return [
							{
								index: 3,
								amount: "2",
								recipient: "B62timeout",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: false,
								hash: "submit-pending",
								timestamp: "2026-03-10T00:00:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return false
					},
					async canCancelDeposit() {
						return false
					},
					async cancelDeposit() {
						throw new Error("cancelDeposit should not be called")
					},
					async finalizeDeposit() {
						throw new Error("finalizeDeposit should not be called")
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {
					sleepCalls += 1
					if (sleepCalls >= 1) {
						throw new Error("stop-after-first-sleep")
					}
				},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("failed")
		expect(result.lastError).toBe("stop-after-first-sleep")
		expect(statusCalls).toBe(1)
		expect(events.some((entry) => entry.event === "cancel-submitted")).toBe(false)
		expect(events.some((entry) => entry.event === "heartbeat")).toBe(true)
	})

	it.skip("does not resubmit the same prior skippable cancellation while the first cancel is still pending", async () => {
		let statusCalls = 0
		const cancelCalls: string[] = []

		const result = await runBridgeOperation(
			{
				id: "op-avoid-duplicate-cancel",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62cancel"
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: false
						}
					},
					async getDepositStatuses() {
						statusCalls += 1
						return [
							{
								index: 0,
								amount: "1",
								recipient: "B62older",
								cancelled: false,
								cancellable: true,
								synced: true,
								accepted: false,
								confirmed: false,
								finalised: false,
								hash: "submit-older",
								timestamp: "2026-03-09T19:00:00.000Z"
							},
							{
								index: 1,
								amount: "2",
								recipient: "B62cancel",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: false,
								hash: "submit-current",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return false
					},
					async canCancelDeposit() {
						return true
					},
					async cancelDeposit() {
						cancelCalls.push(`cancel-${cancelCalls.length + 1}`)
						return {
							success: true,
							direction: "deposit",
							action: "cancel",
							route: "mina:testnet->zeko-m:testnet",
							hash: `cancel-${cancelCalls.length}`,
							explorerUrl: "https://minascan.io/devnet/tx/cancel-older",
							included: false
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {
					if (statusCalls >= 2) {
						throw new Error("stop-after-second-poll")
					}
				},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("failed")
		expect(result.lastError).toBe("stop-after-second-poll")
		expect(cancelCalls).toEqual(["cancel-1"])
	})

	it.skip("retries a stale finalize submission when the claimable index never clears", async () => {
		let statusCalls = 0
		const finalizeCalls: string[] = []

		const result = await runBridgeOperation(
			{
				id: "op-retry-stale-finalize",
				from: "mina:testnet",
				to: "zeko-m:testnet",
				amount: "2",
				account: "B62finalize"
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko-m:testnet",
							hash: "submit-current",
							explorerUrl: "https://minascan.io/devnet/tx/submit-current",
							included: false
						}
					},
					async getDepositStatuses() {
						statusCalls += 1

						if (finalizeCalls.length >= 2) {
							return [
								{
									index: 7,
									amount: "2",
									recipient: "B62finalize",
									cancelled: false,
									synced: true,
									accepted: true,
									confirmed: true,
									finalised: true,
									hash: "finalize-second",
									timestamp: "2026-03-09T19:03:00.000Z"
								}
							]
						}

						return [
							{
								index: 7,
								amount: "2",
								recipient: "B62finalize",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: false,
								hash: "submit-current",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					},
					async canFinalizeDeposit() {
						return true
					},
					async canCancelDeposit() {
						return false
					},
					async finalizeDeposit() {
						const hash = finalizeCalls.length === 0 ? "finalize-first" : "finalize-second"
						finalizeCalls.push(hash)
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko-m:testnet",
							hash,
							explorerUrl: `https://zekoscan.io/testnet/tx/${hash}`,
							included: false
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async () => {},
				sleep: async () => {},
				pollIntervalMs: 0,
				now: () =>
					statusCalls >= 2 && finalizeCalls.length === 1
						? "2026-03-10T00:03:01.000Z"
						: finalizeCalls.length >= 2
							? "2026-03-10T00:03:02.000Z"
							: "2026-03-10T00:00:00.000Z"
			}
		)

		expect(statusCalls).toBeGreaterThanOrEqual(3)
		expect(finalizeCalls).toEqual(["finalize-first", "finalize-second"])
		expect(result.status).toBe("completed")
		expect(result.finalTransaction?.hash).toBe("finalize-second")
	})

	it.skip("keeps waiting when a queued withdrawal looks claimable before witnesses are ready", async () => {
		let withdrawalStatusCalls = 0
		let finalizeAttempts = 0
		const events: Array<{ event: string; details?: Record<string, unknown> }> = []

		const result = await runBridgeOperation(
			{
				id: "op-withdrawal-claim-pending",
				from: "zeko-m:testnet",
				to: "mina:testnet",
				amount: "1",
				account: "B62claim"
			},
			{
				adapter: {
					async submitWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdraw-submit-current",
							explorerUrl: "https://zekoscan.io/testnet/tx/withdraw-submit-current",
							included: false
						}
					},
					async getWithdrawalStatuses() {
						withdrawalStatusCalls += 1

						if (withdrawalStatusCalls === 1) {
							return [
								{
									index: 7,
									amount: "2",
									recipient: "B62claim",
									committed: true,
									finalised: false,
									hash: "withdraw-submit-older",
									timestamp: "2026-03-09T19:00:00.000Z"
								}
							]
						}

						if (withdrawalStatusCalls === 2) {
							return [
								{
									index: 7,
									amount: "2",
									recipient: "B62claim",
									committed: true,
									finalised: false,
									hash: "withdraw-submit-older",
									timestamp: "2026-03-09T19:00:00.000Z"
								},
								{
									index: 8,
									amount: "1",
									recipient: "B62claim",
									committed: true,
									finalised: false,
									hash: "withdraw-submit-current",
									timestamp: "2026-03-09T19:01:00.000Z"
								}
							]
						}

						return [
							{
								index: 7,
								amount: "2",
								recipient: "B62claim",
								committed: true,
								finalised: true,
								hash: "withdraw-finalize-older",
								timestamp: "2026-03-09T19:02:00.000Z"
							},
							{
								index: 8,
								amount: "1",
								recipient: "B62claim",
								committed: true,
								finalised: true,
								hash: "withdraw-finalize-current",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					},
					async canFinalizeWithdrawal() {
						return true
					},
					async finalizeWithdrawal() {
						finalizeAttempts += 1
						if (finalizeAttempts === 1) {
							throw new Error("Did not find any withdrawal to finalize")
						}

						return {
							success: true,
							direction: "withdrawal",
							action: "finalize",
							route: "zeko-m:testnet->mina:testnet",
							hash: "withdraw-finalize-current",
							explorerUrl: "https://minascan.io/devnet/tx/withdraw-finalize-current",
							included: false
						}
					}
				},
				sessionStore: {
					async save() {}
				},
				log: async ({ event, details }) => {
					events.push({ event, details })
				},
				sleep: async () => {},
				pollIntervalMs: 0
			}
		)

		expect(result.status).toBe("completed")
		expect(finalizeAttempts).toBe(2)
		expect(
			events.some(
				(entry) =>
					entry.event === "claim-pending" &&
					entry.details?.message === "Did not find any withdrawal to finalize"
			)
		).toBe(true)
	})
})
