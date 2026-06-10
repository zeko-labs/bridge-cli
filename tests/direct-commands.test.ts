import { runCommand } from "citty"
import { PrivateKey } from "o1js"
import { describe, expect, it } from "vitest"
import type { BridgeAdapter } from "../src/core/adapter"
import {
	createDepositCommand,
	createWithdrawalCommand,
	runDepositCancel,
	runDepositFinalize,
	runDepositStatus,
	runDepositSubmit,
	runWithdrawalFinalize,
	runWithdrawalStatus,
	runWithdrawalSubmit
} from "../src/commands/direct"
import { DEFAULT_DEPOSIT_TIMEOUT_SLOTS } from "../src/core/timeouts"

const createDepositAdapter = (overrides: Partial<BridgeAdapter>): BridgeAdapter => ({
	async getDepositStatuses() {
		return []
	},
	async getWithdrawalStatuses() {
		return []
	},
	async submitDeposit() {
		throw new Error("submitDeposit not implemented for this test")
	},
	async finalizeDeposit() {
		throw new Error("finalizeDeposit not implemented for this test")
	},
	async cancelDeposit() {
		throw new Error("cancelDeposit not implemented for this test")
	},
	async submitWithdrawal() {
		throw new Error("submitWithdrawal should not be called in a deposit test")
	},
	async finalizeWithdrawal() {
		throw new Error("finalizeWithdrawal should not be called in a deposit test")
	},
	...overrides
})

const createWithdrawalAdapter = (overrides: Partial<BridgeAdapter>): BridgeAdapter => ({
	async getDepositStatuses() {
		return []
	},
	async getWithdrawalStatuses() {
		return []
	},
	async submitDeposit() {
		throw new Error("submitDeposit should not be called in a withdrawal test")
	},
	async finalizeDeposit() {
		throw new Error("finalizeDeposit should not be called in a withdrawal test")
	},
	async cancelDeposit() {
		throw new Error("cancelDeposit should not be called in a withdrawal test")
	},
	async submitWithdrawal() {
		throw new Error("submitWithdrawal not implemented for this test")
	},
	async finalizeWithdrawal() {
		throw new Error("finalizeWithdrawal not implemented for this test")
	},
	...overrides
})

type RunnableSubCommand = {
	run?: (context: {
		rawArgs: string[]
		args: Record<string, unknown>
		cmd: unknown
	}) => Promise<void>
}

const resolveSubCommands = async (value: unknown): Promise<Record<string, RunnableSubCommand>> => {
	if (typeof value === "function") {
		return resolveSubCommands(await value())
	}

	if (typeof value !== "object" || value === null) {
		throw new Error("Expected command subcommands to be defined")
	}

	return value as Record<string, RunnableSubCommand>
}

const withWalletPrivateKey = async (
	run: (input: { publicKey: string }) => Promise<void>
): Promise<void> => {
	const previous = process.env.MINA_PRIVATE_KEY
	const signer = PrivateKey.random()
	process.env.MINA_PRIVATE_KEY = signer.toBase58()

	try {
		await run({ publicKey: signer.toPublicKey().toBase58() })
	} finally {
		if (previous === undefined) {
			delete process.env.MINA_PRIVATE_KEY
		} else {
			process.env.MINA_PRIVATE_KEY = previous
		}
	}
}

describe("direct commands", () => {
	it("submits a deposit", async () => {
		const result = await runDepositSubmit(
			{
				from: "mina:testnet",
				to: "zeko:testnet",
				json: false,
				account: "B62test",
				amount: "1",
				timeoutSlots: 10,
				wait: true
			},
			{
				adapter: {
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-submit",
							explorerUrl: "https://example.test/deposit-submit",
							included: true
						}
					}
				}
			}
		)

		expect(result.action).toBe("submit")
		expect(result.hash).toBe("deposit-submit")
	})

	it("defaults direct deposit submissions to a 24 hour timeout window", async () => {
		const seenTimeouts: Array<number | undefined> = []

		await runDepositSubmit(
			{
				from: "mina:testnet",
				to: "zeko:testnet",
				json: false,
				account: "B62test",
				amount: "1",
				wait: true
			},
			{
				adapter: {
					async submitDeposit(input) {
						seenTimeouts.push(input.timeoutSlots)
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-submit-default-timeout",
							explorerUrl: "https://example.test/deposit-submit-default-timeout",
							included: true
						}
					}
				}
			}
		)

		expect(seenTimeouts).toEqual([DEFAULT_DEPOSIT_TIMEOUT_SLOTS])
	})

	it("accepts --timeout-slots on the direct deposit submit command", async () => {
		const seenTimeouts: Array<number | undefined> = []
		const command = createDepositCommand({
			createAdapter: async () =>
				createDepositAdapter({
					async submitDeposit(input) {
						seenTimeouts.push(input.timeoutSlots)
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-submit-kebab-timeout",
							explorerUrl: "https://example.test/deposit-submit-kebab-timeout",
							included: false
						}
					}
				}),
			write: () => {}
		})

		await runCommand(command, {
			rawArgs: [
				"submit",
				"--account",
				"B62test",
				"--amount",
				"1",
				"--timeout-slots",
				"1",
				"--wait",
				"false"
			]
		})

		expect(seenTimeouts).toEqual([1])
	})

	it("retries recoverable deposit submit mutations and eventually succeeds", async () => {
		const sleepCalls: number[] = []
		let attempts = 0

		const result = await runDepositSubmit(
			{
				from: "mina:testnet",
				to: "zeko:testnet",
				json: false,
				account: "B62test",
				amount: "1",
				timeoutSlots: 1,
				wait: false
			},
			{
				adapter: {
					async submitDeposit() {
						attempts += 1
						if (attempts < 6) {
							throw new Error("No key returned from mutation")
						}

						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-submit-retried",
							explorerUrl: "https://example.test/deposit-submit-retried",
							included: false
						}
					}
				},
				sleep: async (ms) => {
					sleepCalls.push(ms)
				},
				retryDelayMs: 7
			}
		)

		expect(result.hash).toBe("deposit-submit-retried")
		expect(attempts).toBe(6)
		expect(sleepCalls).toEqual([7, 14, 28, 56, 112])
	})

	it("stops retrying recoverable deposit submit mutations after the retry budget", async () => {
		const sleepCalls: number[] = []
		let attempts = 0

		await expect(
			runDepositSubmit(
				{
					from: "mina:testnet",
					to: "zeko:testnet",
					json: false,
					account: "B62test",
					amount: "1",
					timeoutSlots: 1,
					wait: false
				},
				{
					adapter: {
						async submitDeposit() {
							attempts += 1
							throw new Error("No key returned from mutation")
						}
					},
					sleep: async (ms) => {
						sleepCalls.push(ms)
					},
					retryDelayMs: 7
				}
			)
		).rejects.toThrow("No key returned from mutation")

		expect(attempts).toBe(6)
		expect(sleepCalls).toEqual([7, 14, 28, 56, 112])
	})

	it("does not retry non-recoverable deposit submit failures", async () => {
		let attempts = 0

		await expect(
			runDepositSubmit(
				{
					from: "mina:testnet",
					to: "zeko:testnet",
					json: false,
					account: "B62test",
					amount: "1",
					timeoutSlots: 1,
					wait: false
				},
				{
					adapter: {
						async submitDeposit() {
							attempts += 1
							throw new Error("Transaction failed with errors: insufficient funds")
						}
					},
					sleep: async () => {},
					retryDelayMs: 7
				}
			)
		).rejects.toThrow("insufficient funds")

		expect(attempts).toBe(1)
	})

	it("finalizes a deposit", async () => {
		const result = await runDepositFinalize(
			{
				from: "mina:testnet",
				to: "zeko:testnet",
				json: false,
				account: "B62test",
				wait: true
			},
			{
				adapter: {
					async finalizeDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-finalize",
							explorerUrl: "https://example.test/deposit-finalize",
							included: true
						}
					}
				}
			}
		)

		expect(result.action).toBe("finalize")
		expect(result.hash).toBe("deposit-finalize")
	})

	it("cancels a deposit", async () => {
		const result = await runDepositCancel(
			{
				from: "mina:testnet",
				to: "zeko:testnet",
				json: false,
				account: "B62test",
				wait: true
			},
			{
				adapter: {
					async cancelDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "cancel",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-cancel",
							explorerUrl: "https://example.test/deposit-cancel",
							included: true
						}
					}
				}
			}
		)

		expect(result.action).toBe("cancel")
		expect(result.hash).toBe("deposit-cancel")
	})

	it("returns the latest deposit when latest is requested", async () => {
		const result = await runDepositStatus(
			{
				account: "B62test",
				from: "mina:testnet",
				to: "zeko:testnet",
				latest: true
			},
			{
				adapter: {
					async getDepositStatuses() {
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
								hash: "hash-0",
								timestamp: "2026-03-09T19:00:00.000Z"
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
								hash: "hash-1",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					}
				}
			}
		)

		expect(result.direction).toBe("deposit")
		expect(result.count).toBe(1)
		expect(result.operations[0]?.index).toBe(1)
	})

	it("submits a withdrawal", async () => {
		const result = await runWithdrawalSubmit(
			{
				from: "zeko:testnet",
				to: "mina:testnet",
				json: false,
				account: "B62test",
				amount: "3",
				wait: true
			},
			{
				adapter: {
					async submitWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko:testnet->mina:testnet",
							hash: "withdraw-submit",
							explorerUrl: "https://example.test/withdraw-submit",
							included: true
						}
					}
				}
			}
		)

		expect(result.action).toBe("submit")
		expect(result.hash).toBe("withdraw-submit")
	})

	it("retries recoverable withdrawal submit mutations with the same budget as deposits", async () => {
		const sleepCalls: number[] = []
		let attempts = 0

		const result = await runWithdrawalSubmit(
			{
				from: "zeko:testnet",
				to: "mina:testnet",
				json: false,
				account: "B62test",
				amount: "3",
				wait: false
			},
			{
				adapter: {
					async submitWithdrawal() {
						attempts += 1
						if (attempts < 6) {
							throw new Error("No key returned from mutation")
						}

						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko:testnet->mina:testnet",
							hash: "withdraw-submit-retried",
							explorerUrl: "https://example.test/withdraw-submit-retried",
							included: false
						}
					}
				},
				sleep: async (ms) => {
					sleepCalls.push(ms)
				},
				retryDelayMs: 7
			}
		)

		expect(result.hash).toBe("withdraw-submit-retried")
		expect(attempts).toBe(6)
		expect(sleepCalls).toEqual([7, 14, 28, 56, 112])
	})

	it("finalizes a withdrawal", async () => {
		const result = await runWithdrawalFinalize(
			{
				from: "zeko:testnet",
				to: "mina:testnet",
				json: false,
				account: "B62test",
				wait: true
			},
			{
				adapter: {
					async finalizeWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "finalize",
							route: "zeko:testnet->mina:testnet",
							hash: "withdraw-finalize",
							explorerUrl: "https://example.test/withdraw-finalize",
							included: true
						}
					}
				}
			}
		)

		expect(result.action).toBe("finalize")
		expect(result.hash).toBe("withdraw-finalize")
	})

	it("returns all withdrawals when latest is disabled", async () => {
		const result = await runWithdrawalStatus(
			{
				account: "B62test",
				from: "zeko:testnet",
				to: "mina:testnet",
				latest: false
			},
			{
				adapter: {
					async getWithdrawalStatuses() {
						return [
							{
								index: 0,
								amount: "3",
								recipient: "B62test",
								committed: true,
								finalised: false,
								hash: "hash-0",
								timestamp: "2026-03-09T19:02:00.000Z"
							},
							{
								index: 1,
								amount: "5",
								recipient: "B62test",
								committed: true,
								finalised: true,
								hash: "hash-1",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					}
				}
			}
		)

		expect(result.direction).toBe("withdrawal")
		expect(result.count).toBe(2)
		expect(result.operations.map((item) => item.index)).toEqual([0, 1])
	})

	it("runs the deposit submit command", async () => {
		const writes: string[] = []
		const command = createDepositCommand({
			write: (message) => writes.push(message),
			createAdapter: async () =>
				createDepositAdapter({
					async submitDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "submit",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-submit-command",
							explorerUrl: "https://example.test/deposit-submit-command",
							included: true
						}
					}
				})
		})
		const subCommands = await resolveSubCommands(command.subCommands)

		await subCommands.submit?.run?.({
			rawArgs: [],
			args: { _: [], amount: "1", account: "B62test", from: "mina:testnet", to: "zeko:testnet" },
			cmd: subCommands.submit
		})

		expect(writes[0]).toContain("deposit submit sent")
		expect(writes[0]).toContain("deposit-submit-command")
	})

	it("runs the deposit finalize command", async () => {
		const writes: string[] = []
		const command = createDepositCommand({
			write: (message) => writes.push(message),
			createAdapter: async () =>
				createDepositAdapter({
					async finalizeDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "finalize",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-finalize-command",
							explorerUrl: "https://example.test/deposit-finalize-command",
							included: true
						}
					}
				})
		})
		const subCommands = await resolveSubCommands(command.subCommands)

		await subCommands.finalize?.run?.({
			rawArgs: [],
			args: { _: [], account: "B62test", from: "mina:testnet", to: "zeko:testnet" },
			cmd: subCommands.finalize
		})

		expect(writes[0]).toContain("deposit finalize sent")
		expect(writes[0]).toContain("deposit-finalize-command")
	})

	it("runs the deposit cancel command", async () => {
		const writes: string[] = []
		const command = createDepositCommand({
			write: (message) => writes.push(message),
			createAdapter: async () =>
				createDepositAdapter({
					async cancelDeposit() {
						return {
							success: true,
							direction: "deposit",
							action: "cancel",
							route: "mina:testnet->zeko:testnet",
							hash: "deposit-cancel-command",
							explorerUrl: "https://example.test/deposit-cancel-command",
							included: true
						}
					}
				})
		})
		const subCommands = await resolveSubCommands(command.subCommands)

		await subCommands.cancel?.run?.({
			rawArgs: [],
			args: { _: [], account: "B62test", from: "mina:testnet", to: "zeko:testnet" },
			cmd: subCommands.cancel
		})

		expect(writes[0]).toContain("deposit cancel sent")
		expect(writes[0]).toContain("deposit-cancel-command")
	})

	it("runs the deposit status command", async () => {
		const writes: string[] = []
		const command = createDepositCommand({
			write: (message) => writes.push(message),
			createAdapter: async () =>
				createDepositAdapter({
					async getDepositStatuses() {
						return [
							{
								index: 1,
								amount: "2",
								recipient: "B62test",
								cancelled: false,
								synced: true,
								accepted: true,
								confirmed: true,
								finalised: true,
								hash: "deposit-status-command",
								timestamp: "2026-03-09T19:01:00.000Z"
							}
						]
					}
				})
		})
		const subCommands = await resolveSubCommands(command.subCommands)

		await subCommands.status?.run?.({
			rawArgs: [],
			args: {
				_: [],
				account: "B62test",
				from: "mina:testnet",
				to: "zeko:testnet",
				latest: true
			},
			cmd: subCommands.status
		})

		expect(writes[0]).toContain("deposit status")
		expect(writes[0]).toContain("Account: B62test")
		expect(writes[0]).toContain("deposit-status-command")
	})

	it("defaults deposit status to the signer account", async () => {
		await withWalletPrivateKey(async ({ publicKey }) => {
			const writes: string[] = []
			let seenAccount: string | undefined
			const command = createDepositCommand({
				write: (message) => writes.push(message),
				createAdapter: async () =>
					createDepositAdapter({
						async getDepositStatuses(account) {
							seenAccount = account
							return []
						}
					})
			})
			const subCommands = await resolveSubCommands(command.subCommands)

			await subCommands.status?.run?.({
				rawArgs: [],
				args: {
					_: [],
					from: "mina:testnet",
					to: "zeko:testnet",
					latest: true
				},
				cmd: subCommands.status
			})

			expect(seenAccount).toBe(publicKey)
			expect(writes[0]).toContain(`Account: ${publicKey}`)
		})
	})

	it("runs the withdrawal submit command", async () => {
		const writes: string[] = []
		const command = createWithdrawalCommand({
			write: (message) => writes.push(message),
			createAdapter: async () =>
				createWithdrawalAdapter({
					async submitWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "submit",
							route: "zeko:testnet->mina:testnet",
							hash: "withdraw-submit-command",
							explorerUrl: "https://example.test/withdraw-submit-command",
							included: true
						}
					}
				})
		})
		const subCommands = await resolveSubCommands(command.subCommands)

		await subCommands.submit?.run?.({
			rawArgs: [],
			args: { _: [], amount: "3", account: "B62test", from: "zeko:testnet", to: "mina:testnet" },
			cmd: subCommands.submit
		})

		expect(writes[0]).toContain("withdrawal submit sent")
		expect(writes[0]).toContain("withdraw-submit-command")
	})

	it("runs the withdrawal finalize command", async () => {
		const writes: string[] = []
		const command = createWithdrawalCommand({
			write: (message) => writes.push(message),
			createAdapter: async () =>
				createWithdrawalAdapter({
					async finalizeWithdrawal() {
						return {
							success: true,
							direction: "withdrawal",
							action: "finalize",
							route: "zeko:testnet->mina:testnet",
							hash: "withdraw-finalize-command",
							explorerUrl: "https://example.test/withdraw-finalize-command",
							included: true
						}
					}
				})
		})
		const subCommands = await resolveSubCommands(command.subCommands)

		await subCommands.finalize?.run?.({
			rawArgs: [],
			args: { _: [], account: "B62test", from: "zeko:testnet", to: "mina:testnet" },
			cmd: subCommands.finalize
		})

		expect(writes[0]).toContain("withdrawal finalize sent")
		expect(writes[0]).toContain("withdraw-finalize-command")
	})

	it("runs the withdrawal status command", async () => {
		const writes: string[] = []
		const command = createWithdrawalCommand({
			write: (message) => writes.push(message),
			createAdapter: async () =>
				createWithdrawalAdapter({
					async getWithdrawalStatuses() {
						return [
							{
								index: 1,
								amount: "5",
								recipient: "B62test",
								committed: true,
								finalised: true,
								hash: "withdraw-status-command",
								timestamp: "2026-03-09T19:03:00.000Z"
							}
						]
					}
				})
		})
		const subCommands = await resolveSubCommands(command.subCommands)

		await subCommands.status?.run?.({
			rawArgs: [],
			args: {
				_: [],
				account: "B62test",
				from: "zeko:testnet",
				to: "mina:testnet",
				latest: true
			},
			cmd: subCommands.status
		})

		expect(writes[0]).toContain("withdrawal status")
		expect(writes[0]).toContain("Account: B62test")
		expect(writes[0]).toContain("withdraw-status-command")
	})

	it("defaults withdrawal status to the signer account", async () => {
		await withWalletPrivateKey(async ({ publicKey }) => {
			const writes: string[] = []
			let seenAccount: string | undefined
			const command = createWithdrawalCommand({
				write: (message) => writes.push(message),
				createAdapter: async () =>
					createWithdrawalAdapter({
						async getWithdrawalStatuses(account) {
							seenAccount = account
							return []
						}
					})
			})
			const subCommands = await resolveSubCommands(command.subCommands)

			await subCommands.status?.run?.({
				rawArgs: [],
				args: {
					_: [],
					from: "zeko:testnet",
					to: "mina:testnet",
					latest: true
				},
				cmd: subCommands.status
			})

			expect(seenAccount).toBe(publicKey)
			expect(writes[0]).toContain(`Account: ${publicKey}`)
		})
	})
})
