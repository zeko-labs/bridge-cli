import { describe, expect, it } from "vitest"
import { createBridgeCommand } from "../src/commands/bridge"
import { createOperationCommand } from "../src/commands/operation"
import type { BridgeAdapter } from "../src/core/adapter"
import { createBridgeCliCommand } from "../src/core/root-command"
import type { OperationSession } from "../src/core/types"
import type { CommandDef } from "citty"

const resolveSubCommands = async (subCommands: unknown): Promise<Record<string, unknown>> => {
	if (typeof subCommands === "function") {
		return resolveSubCommands(await subCommands())
	}

	return typeof subCommands === "object" && subCommands !== null
		? (subCommands as Record<string, unknown>)
		: {}
}

const resolveCommand = async (command: unknown): Promise<CommandDef | undefined> => {
	if (typeof command === "function") {
		return resolveCommand(await command())
	}
	if (command && typeof (command as Promise<CommandDef>).then === "function") {
		return resolveCommand(await command)
	}

	return typeof command === "object" && command !== null ? (command as CommandDef) : undefined
}

describe("cli skeleton", () => {
	it("exposes the planned top-level command groups", async () => {
		const cli = createBridgeCliCommand()
		const subCommands = await resolveSubCommands(cli.subCommands)

		expect(Object.keys(subCommands).sort()).toEqual([
			"bridge",
			"deposit",
			"doctor",
			"operation",
			"tui",
			"withdrawal"
		])
	})

	it("keeps bridge as the default high-level command without a public wait flag", async () => {
		const cli = createBridgeCliCommand()
		const subCommands = await resolveSubCommands(cli.subCommands)
		const bridge = await resolveCommand(subCommands.bridge)

		expect(bridge?.args).toBeDefined()
		expect(bridge?.args).not.toHaveProperty("wait")
	})

	it("exposes poll and retry delay flags on long-running operation commands", async () => {
		const cli = createBridgeCliCommand()
		const subCommands = await resolveSubCommands(cli.subCommands)
		const bridge = await resolveCommand(subCommands.bridge)
		const operation = await resolveCommand(subCommands.operation)
		const operationSubCommands = await resolveSubCommands(operation?.subCommands)
		const resume = await resolveCommand(operationSubCommands.resume)
		const resumeAll = await resolveCommand(operationSubCommands["resume-all"])

		for (const command of [bridge, resume, resumeAll]) {
			expect(command?.args).toHaveProperty("pollIntervalMs")
			expect(command?.args).toHaveProperty("retryDelayMs")
		}
	})

	it("requires an amount on the high-level bridge command", async () => {
		const command = createBridgeCommand()

		await expect(
			command.run?.({
				args: {
					_: [],
					from: "mina:testnet",
					to: "zeko:testnet",
					amount: "",
					account: "B62test",
					recipient: "B62test",
					timeoutSlots: "",
					pollIntervalMs: "",
					retryDelayMs: "",
					json: false,
					verbose: false
				},
				rawArgs: [],
				cmd: command
			})
		).rejects.toThrow("Missing required --amount")
	})

	it("accepts kebab-case poll delay on the high-level bridge command", async () => {
		const sleeps: number[] = []
		const adapter: BridgeAdapter = {
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
			},
			async getDepositStatuses() {
				return []
			},
			async getWithdrawalStatuses() {
				return []
			},
			async canFinalizeDeposit() {
				return { available: false, reason: "not ready" }
			},
			async canCancelDeposit() {
				return { available: false, reason: "not ready" }
			},
			async submitWithdrawal() {
				throw new Error("submitWithdrawal should not be called")
			},
			async finalizeDeposit() {
				throw new Error("finalizeDeposit should not be called")
			},
			async finalizeWithdrawal() {
				throw new Error("finalizeWithdrawal should not be called")
			},
			async cancelDeposit() {
				throw new Error("cancelDeposit should not be called")
			}
		}
		const command = createBridgeCommand({
			resolvePaths: () => ({
				dataDir: "/tmp/data",
				stateDir: "/tmp/state",
				logDir: "/tmp/logs",
				cacheDir: "/tmp/cache"
			}),
			createStore: () => ({
				async save() {}
			}),
			createLogger: () => ({
				async write() {}
			}),
			createAdapter: async () => adapter,
			generateId: () => "bridge-op-poll-delay",
			write: () => {},
			writeProgress: () => {},
			sleep: async (ms) => {
				sleeps.push(ms)
				throw new Error("stop after first public poll")
			},
			now: () => "2026-03-10T00:00:00.000Z"
		})

		await command.run?.({
			args: {
				_: [],
				from: "mina:testnet",
				to: "zeko:testnet",
				amount: "2",
				account: "B62test",
				recipient: "B62test",
				timeoutSlots: "",
				"timeout-slots": "",
				pollIntervalMs: "",
				"poll-interval-ms": "180000",
				retryDelayMs: "",
				"retry-delay-ms": "",
				json: false,
				verbose: false
			},
			rawArgs: [],
			cmd: command
		})

		expect(sleeps).toEqual([180_000])
	})

	it("accepts kebab-case poll delay on operation resume", async () => {
		const sleeps: number[] = []
		const session: OperationSession = {
			id: "resume-poll-delay",
			status: "running",
			phase: "submitted",
			route: "zeko:testnet->mina:testnet",
			direction: "withdrawal",
			account: "B62test",
			recipient: "B62test",
			amount: "2",
			logPath: "/tmp/resume-poll-delay.jsonl",
			createdAt: "2026-03-10T00:00:00.000Z",
			updatedAt: "2026-03-10T00:00:00.000Z",
			submittedTransactions: [{ action: "submit", hash: "withdrawal-submit" }]
		}
		const adapter: BridgeAdapter = {
			async getDepositStatuses() {
				return []
			},
			async getWithdrawalStatuses() {
				return []
			},
			async canFinalizeWithdrawal() {
				return { available: false, reason: "not ready", status: "waiting" }
			},
			async submitDeposit() {
				throw new Error("submitDeposit should not be called")
			},
			async submitWithdrawal() {
				throw new Error("submitWithdrawal should not be called")
			},
			async finalizeDeposit() {
				throw new Error("finalizeDeposit should not be called")
			},
			async finalizeWithdrawal() {
				throw new Error("finalizeWithdrawal should not be called")
			},
			async cancelDeposit() {
				throw new Error("cancelDeposit should not be called")
			}
		}
		const operation = createOperationCommand({
			resolvePaths: () => ({
				dataDir: "/tmp/data",
				stateDir: "/tmp/state",
				logDir: "/tmp/logs",
				cacheDir: "/tmp/cache"
			}),
			createStore: () => ({
				async list() {
					return [session]
				},
				async load(id) {
					return id === session.id ? session : null
				},
				async save() {}
			}),
			createLogger: () => ({
				async write() {}
			}),
			createAdapter: async () => adapter,
			write: () => {},
			writeProgress: () => {},
			sleep: async (ms) => {
				sleeps.push(ms)
				throw new Error("stop after first public resume poll")
			},
			now: () => "2026-03-10T00:00:00.000Z"
		})
		const subCommands = await resolveSubCommands(operation.subCommands)
		const resume = await resolveCommand(subCommands.resume)
		if (!resume) throw new Error("resume command was not resolved")

		await resume.run?.({
			args: {
				_: [],
				id: session.id,
				pollIntervalMs: "",
				"poll-interval-ms": "180000",
				retryDelayMs: "",
				"retry-delay-ms": "",
				json: false,
				verbose: false
			},
			rawArgs: [],
			cmd: resume
		})

		expect(sleeps).toEqual([180_000])
	})

	it("accepts kebab-case timeout slots on the high-level bridge command", async () => {
		const seenTimeouts: Array<number | undefined> = []
		const adapter: BridgeAdapter = {
			async submitDeposit(input) {
				seenTimeouts.push(input.timeoutSlots)
				return {
					success: true,
					direction: "deposit",
					action: "submit",
					route: "mina:testnet->zeko:testnet",
					hash: "deposit-submit",
					explorerUrl: "https://example.test/deposit-submit",
					included: true
				}
			},
			async getDepositStatuses() {
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
						hash: "deposit-submit",
						timestamp: "2026-03-10T00:00:01.000Z"
					}
				]
			},
			async getWithdrawalStatuses() {
				return []
			},
			async submitWithdrawal() {
				throw new Error("submitWithdrawal should not be called")
			},
			async finalizeDeposit() {
				throw new Error("finalizeDeposit should not be called")
			},
			async finalizeWithdrawal() {
				throw new Error("finalizeWithdrawal should not be called")
			},
			async cancelDeposit() {
				throw new Error("cancelDeposit should not be called")
			}
		}
		const command = createBridgeCommand({
			resolvePaths: () => ({
				dataDir: "/tmp/data",
				stateDir: "/tmp/state",
				logDir: "/tmp/logs",
				cacheDir: "/tmp/cache"
			}),
			createStore: () => ({
				async save() {}
			}),
			createLogger: () => ({
				async write() {}
			}),
			createAdapter: async () => adapter,
			generateId: () => "bridge-op-timeout",
			write: () => {},
			writeProgress: () => {},
			sleep: async () => {},
			pollIntervalMs: 0,
			now: () => "2026-03-10T00:00:00.000Z"
		})

		await command.run?.({
			args: {
				_: [],
				from: "mina:testnet",
				to: "zeko:testnet",
				amount: "2",
				account: "B62test",
				recipient: "B62test",
				timeoutSlots: "",
				"timeout-slots": "1",
				pollIntervalMs: "",
				"poll-interval-ms": "",
				retryDelayMs: "",
				"retry-delay-ms": "",
				json: false,
				verbose: false
			},
			rawArgs: [],
			cmd: command
		})

		expect(seenTimeouts).toEqual([1])
	})

	it("retries transient bridge initialization failures with exponential backoff", async () => {
		const sleeps: number[] = []
		const progress: string[] = []
		let initAttempts = 0
		let submitCalls = 0
		const adapter: BridgeAdapter = {
			async submitDeposit() {
				submitCalls += 1
				return {
					success: true,
					direction: "deposit",
					action: "submit",
					route: "mina:testnet->zeko:testnet",
					hash: "deposit-submit",
					explorerUrl: "https://example.test/deposit-submit",
					included: true
				}
			},
			async getDepositStatuses() {
				if (submitCalls === 0) return []

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
						hash: "deposit-submit",
						timestamp: "2026-03-10T00:00:01.000Z"
					}
				]
			},
			async getWithdrawalStatuses() {
				return []
			},
			async submitWithdrawal() {
				throw new Error("submitWithdrawal should not be called")
			},
			async finalizeDeposit() {
				throw new Error("finalizeDeposit should not be called")
			},
			async finalizeWithdrawal() {
				throw new Error("finalizeWithdrawal should not be called")
			},
			async cancelDeposit() {
				throw new Error("cancelDeposit should not be called")
			}
		}
		const command = createBridgeCommand({
			resolvePaths: () => ({
				dataDir: "/tmp/data",
				stateDir: "/tmp/state",
				logDir: "/tmp/logs",
				cacheDir: "/tmp/cache"
			}),
			createStore: () => ({
				async save() {}
			}),
			createLogger: () => ({
				async write() {}
			}),
			createAdapter: async () => {
				initAttempts += 1
				if (initAttempts < 6) {
					throw new Error("Circuits config not found")
				}

				return adapter
			},
			generateId: () => "bridge-op-init-retry",
			write: () => {},
			writeProgress: (message) => {
				progress.push(message)
			},
			sleep: async (ms) => {
				sleeps.push(ms)
			},
			retryDelayMs: 7,
			pollIntervalMs: 0,
			now: () => "2026-03-10T00:00:00.000Z"
		})

		await command.run?.({
			args: {
				_: [],
				from: "mina:testnet",
				to: "zeko:testnet",
				amount: "2",
				account: "B62test",
				recipient: "B62test",
				timeoutSlots: "",
				"timeout-slots": "",
				pollIntervalMs: "",
				"poll-interval-ms": "",
				retryDelayMs: "",
				"retry-delay-ms": "",
				json: false,
				verbose: false
			},
			rawArgs: [],
			cmd: command
		})

		expect(initAttempts).toBe(6)
		expect(sleeps).toEqual([7, 14, 28, 56, 112])
		expect(progress.filter((message) => message.includes("Bridge.init"))).toHaveLength(5)
	})
})
