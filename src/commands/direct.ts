import { defineCommand, type CommandDef } from "citty"
import { PrivateKey } from "o1js"
import type { BridgeAdapter } from "../core/adapter"
import { createDefaultBridgeAdapter, type BridgeAdapterFactory } from "../core/adapter-factory"
import {
	readAliasedStringArg,
	readBooleanArg,
	readOptionalStringArg,
	readRequiredStringArg
} from "../core/command-args"
import { isRecoverableMutationError } from "../core/mutation-errors"
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_MS, retryWithBackoff } from "../core/retry"
import { formatRoute, parseChainRef, type ChainRef } from "../core/routes"
import { resolveSignerKeys } from "../core/signer"
import { resolveDepositTimeoutSlots } from "../core/timeouts"
import { color, icon, keyValue, section } from "../core/terminal"
import type {
	DepositStatus,
	StatusResult,
	TransactionResult,
	WithdrawalStatus
} from "../core/types"

type StatusArgs = {
	account: string
	from: ChainRef
	to: ChainRef
	latest: boolean
}

type RouteArgs = {
	from: ChainRef
	to: ChainRef
	json: boolean
	verbose?: boolean
}

type DepositSubmitArgs = RouteArgs & {
	account?: string
	amount: string
	timeoutSlots?: number
	wait: boolean
}

type DepositActionArgs = RouteArgs & {
	account?: string
	wait: boolean
}

type DepositStatusArgs = RouteArgs & StatusArgs

type WithdrawalSubmitArgs = RouteArgs & {
	account?: string
	amount: string
	wait: boolean
}

type WithdrawalActionArgs = RouteArgs & {
	account?: string
	wait: boolean
}

type WithdrawalStatusArgs = RouteArgs & StatusArgs

type DirectCommandDeps = {
	createAdapter?: BridgeAdapterFactory
	sleep?: (ms: number) => Promise<void>
	retryDelayMs?: number
	write?: (message: string) => void
}

const deriveAccount = (from: ChainRef, explicit?: string): string => {
	if (explicit) return explicit

	const keys = resolveSignerKeys()
	const secret = from.startsWith("zeko:") ? keys.zeko : keys.mina
	return PrivateKey.fromBase58(secret).toPublicKey().toBase58()
}

const parseOptionalNumber = (value: unknown): number | undefined =>
	typeof value === "string" && value.length > 0 ? Number(value) : undefined

const readRouteArgs = (args: Record<string, unknown>): RouteArgs => ({
	from: parseChainRef(args.from, "--from"),
	to: parseChainRef(args.to, "--to"),
	json: readBooleanArg(args, "json"),
	verbose: readBooleanArg(args, "verbose")
})

const readDepositSubmitArgs = (args: Record<string, unknown>): DepositSubmitArgs => ({
	...readRouteArgs(args),
	account: readOptionalStringArg(args, "account"),
	amount: readRequiredStringArg(args, "amount", "Missing required --amount"),
	timeoutSlots: parseOptionalNumber(readAliasedStringArg(args, "timeoutSlots", "timeout-slots")),
	wait: readBooleanArg(args, "wait", true)
})

const readDepositActionArgs = (args: Record<string, unknown>): DepositActionArgs => ({
	...readRouteArgs(args),
	account: readOptionalStringArg(args, "account"),
	wait: readBooleanArg(args, "wait", true)
})

const readDepositStatusArgs = (args: Record<string, unknown>): DepositStatusArgs => {
	const routeArgs = readRouteArgs(args)
	return {
		...routeArgs,
		account: deriveAccount(routeArgs.from, readOptionalStringArg(args, "account")),
		latest: readBooleanArg(args, "latest", true)
	}
}

const readWithdrawalSubmitArgs = (args: Record<string, unknown>): WithdrawalSubmitArgs => ({
	...readRouteArgs(args),
	account: readOptionalStringArg(args, "account"),
	amount: readRequiredStringArg(args, "amount", "Missing required --amount"),
	wait: readBooleanArg(args, "wait", true)
})

const readWithdrawalActionArgs = (args: Record<string, unknown>): WithdrawalActionArgs => ({
	...readRouteArgs(args),
	account: readOptionalStringArg(args, "account"),
	wait: readBooleanArg(args, "wait", true)
})

const readWithdrawalStatusArgs = (args: Record<string, unknown>): WithdrawalStatusArgs => {
	const routeArgs = readRouteArgs(args)
	return {
		...routeArgs,
		account: deriveAccount(routeArgs.from, readOptionalStringArg(args, "account")),
		latest: readBooleanArg(args, "latest", true)
	}
}

const selectLatest = <T extends { index: number }>(items: T[], latest: boolean): T[] =>
	latest ? [...items].sort((left, right) => right.index - left.index).slice(0, 1) : items

const retryRecoverableMutation = async <T>({
	operation,
	run,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	retryDelayMs = DEFAULT_RETRY_DELAY_MS
}: {
	operation: string
	run: () => Promise<T>
	sleep?: (ms: number) => Promise<void>
	retryDelayMs?: number
}): Promise<T> =>
	retryWithBackoff({
		operation,
		run,
		sleep,
		baseDelayMs: retryDelayMs,
		maxRetries: DEFAULT_MAX_RETRIES,
		shouldRetry: isRecoverableMutationError
	})

export const runDepositSubmit = async (
	input: DepositSubmitArgs,
	{
		adapter,
		sleep,
		retryDelayMs
	}: {
		adapter: Pick<BridgeAdapter, "submitDeposit">
		sleep?: (ms: number) => Promise<void>
		retryDelayMs?: number
	}
): Promise<TransactionResult> =>
	retryRecoverableMutation({
		operation: "deposit submit mutation",
		run: () =>
			adapter.submitDeposit({
				account: input.account,
				amount: input.amount,
				timeoutSlots: resolveDepositTimeoutSlots(input.timeoutSlots),
				wait: input.wait
			}),
		sleep,
		retryDelayMs
	})

export const runDepositFinalize = async (
	input: DepositActionArgs,
	{
		adapter
	}: {
		adapter: Pick<BridgeAdapter, "finalizeDeposit">
	}
): Promise<TransactionResult> =>
	adapter.finalizeDeposit({
		account: input.account,
		wait: input.wait
	})

export const runDepositCancel = async (
	input: DepositActionArgs,
	{
		adapter
	}: {
		adapter: Pick<BridgeAdapter, "cancelDeposit">
	}
): Promise<TransactionResult> =>
	adapter.cancelDeposit({
		account: input.account,
		wait: input.wait
	})

export const runDepositStatus = async (
	input: StatusArgs,
	{
		adapter
	}: {
		adapter: Pick<BridgeAdapter, "getDepositStatuses">
	}
): Promise<StatusResult<DepositStatus>> => {
	const operations = selectLatest(await adapter.getDepositStatuses(input.account), input.latest)
	return {
		success: true,
		direction: "deposit",
		route: formatRoute(input.from, input.to),
		account: input.account,
		count: operations.length,
		operations
	}
}

export const runWithdrawalSubmit = async (
	input: WithdrawalSubmitArgs,
	{
		adapter,
		sleep,
		retryDelayMs
	}: {
		adapter: Pick<BridgeAdapter, "submitWithdrawal">
		sleep?: (ms: number) => Promise<void>
		retryDelayMs?: number
	}
): Promise<TransactionResult> =>
	retryRecoverableMutation({
		operation: "withdrawal submit mutation",
		run: () =>
			adapter.submitWithdrawal({
				account: input.account,
				amount: input.amount,
				wait: input.wait
			}),
		sleep,
		retryDelayMs
	})

export const runWithdrawalFinalize = async (
	input: WithdrawalActionArgs,
	{
		adapter
	}: {
		adapter: Pick<BridgeAdapter, "finalizeWithdrawal">
	}
): Promise<TransactionResult> =>
	adapter.finalizeWithdrawal({
		account: input.account,
		wait: input.wait
	})

export const runWithdrawalStatus = async (
	input: StatusArgs,
	{
		adapter
	}: {
		adapter: Pick<BridgeAdapter, "getWithdrawalStatuses">
	}
): Promise<StatusResult<WithdrawalStatus>> => {
	const operations = selectLatest(await adapter.getWithdrawalStatuses(input.account), input.latest)
	return {
		success: true,
		direction: "withdrawal",
		route: formatRoute(input.from, input.to),
		account: input.account,
		count: operations.length,
		operations
	}
}

const renderStatus = <T extends { index: number; hash: string; amount: string; recipient: string }>(
	result: StatusResult<T>
): string =>
	[
		`${icon.info()} ${section(`${result.direction} status`)}`,
		keyValue("Account", result.account),
		keyValue("Route", result.route),
		keyValue("Count", result.count),
		...result.operations.map(
			(item) =>
				`${icon.bullet()} ${color.bold(`#${item.index}`)}  ${keyValue("amount", item.amount)}  ${keyValue(
					"recipient",
					item.recipient
				)}  ${keyValue("hash", item.hash)}`
		)
	].join("\n")

const renderTransaction = (result: TransactionResult): string =>
	[
		`${result.success ? icon.success() : icon.error()} ${section(
			`${result.direction} ${result.action} sent`
		)}`,
		keyValue("Route", result.route),
		keyValue("Hash", result.hash),
		keyValue("Included", result.included ? "yes" : "no"),
		keyValue("Explorer", result.explorerUrl)
	].join("\n")

const stringArg = (defaultValue: string): { type: "string"; default: string } => ({
	type: "string",
	default: defaultValue
})

const booleanArg = (defaultValue: boolean): { type: "boolean"; default: boolean } => ({
	type: "boolean",
	default: defaultValue
})

const routeArgs = (defaults: { from: ChainRef; to: ChainRef }) => ({
	from: stringArg(defaults.from),
	to: stringArg(defaults.to),
	json: booleanArg(false),
	verbose: booleanArg(false)
})

const writeResult = ({
	json,
	result,
	write
}: {
	json: boolean
	result: StatusResult<DepositStatus | WithdrawalStatus> | TransactionResult
	write: (message: string) => void
}) => {
	if (json) {
		write(JSON.stringify(result, null, 2))
		return
	}

	if ("action" in result) {
		write(renderTransaction(result))
		return
	}

	write(renderStatus(result))
}

export const createDepositCommand = (deps: DirectCommandDeps = {}): CommandDef =>
	defineCommand({
		meta: {
			name: "deposit",
			description: "Perform deposit-level bridge operations."
		},
		subCommands: {
			submit: defineCommand({
				meta: {
					name: "submit",
					description: "Submit a deposit transaction."
				},
				args: {
					...routeArgs({ from: "mina:testnet", to: "zeko:testnet" }),
					account: { type: "string", required: false },
					amount: { type: "string", required: true },
					timeoutSlots: { type: "string", required: false, alias: ["timeout-slots"] },
					wait: { type: "boolean", default: true }
				},
				async run({ args }) {
					const commandArgs = readDepositSubmitArgs(args)
					const adapter = await (deps.createAdapter ?? createDefaultBridgeAdapter)({
						from: commandArgs.from,
						to: commandArgs.to,
						verbose: commandArgs.verbose ?? false
					})
					const result = await runDepositSubmit(commandArgs, {
						adapter,
						sleep: deps.sleep,
						retryDelayMs: deps.retryDelayMs
					})
					writeResult({ json: commandArgs.json, result, write: deps.write ?? console.log })
				}
			}),
			finalize: defineCommand({
				meta: {
					name: "finalize",
					description: "Finalize the next eligible deposit."
				},
				args: {
					...routeArgs({ from: "mina:testnet", to: "zeko:testnet" }),
					account: { type: "string", required: false },
					wait: { type: "boolean", default: true }
				},
				async run({ args }) {
					const commandArgs = readDepositActionArgs(args)
					const adapter = await (deps.createAdapter ?? createDefaultBridgeAdapter)({
						from: commandArgs.from,
						to: commandArgs.to,
						verbose: commandArgs.verbose ?? false
					})
					const result = await runDepositFinalize(commandArgs, { adapter })
					writeResult({ json: commandArgs.json, result, write: deps.write ?? console.log })
				}
			}),
			cancel: defineCommand({
				meta: {
					name: "cancel",
					description: "Cancel the next eligible deposit."
				},
				args: {
					...routeArgs({ from: "mina:testnet", to: "zeko:testnet" }),
					account: { type: "string", required: false },
					wait: { type: "boolean", default: true }
				},
				async run({ args }) {
					const commandArgs = readDepositActionArgs(args)
					const adapter = await (deps.createAdapter ?? createDefaultBridgeAdapter)({
						from: commandArgs.from,
						to: commandArgs.to,
						verbose: commandArgs.verbose ?? false
					})
					const result = await runDepositCancel(commandArgs, { adapter })
					writeResult({ json: commandArgs.json, result, write: deps.write ?? console.log })
				}
			}),
			status: defineCommand({
				meta: {
					name: "status",
					description: "List deposit operations for an account."
				},
				args: {
					...routeArgs({ from: "mina:testnet", to: "zeko:testnet" }),
					account: { type: "string", required: false },
					latest: { type: "boolean", default: true }
				},
				async run({ args }) {
					const commandArgs = readDepositStatusArgs(args)
					const adapter = await (deps.createAdapter ?? createDefaultBridgeAdapter)({
						from: commandArgs.from,
						to: commandArgs.to,
						verbose: commandArgs.verbose ?? false
					})
					const result = await runDepositStatus(commandArgs, { adapter })
					writeResult({ json: commandArgs.json, result, write: deps.write ?? console.log })
				}
			})
		}
	})

export const createWithdrawalCommand = (deps: DirectCommandDeps = {}): CommandDef =>
	defineCommand({
		meta: {
			name: "withdrawal",
			description: "Perform withdrawal-level bridge operations."
		},
		subCommands: {
			submit: defineCommand({
				meta: {
					name: "submit",
					description: "Submit a withdrawal transaction."
				},
				args: {
					...routeArgs({ from: "zeko:testnet", to: "mina:testnet" }),
					account: { type: "string", required: false },
					amount: { type: "string", required: true },
					wait: { type: "boolean", default: true }
				},
				async run({ args }) {
					const commandArgs = readWithdrawalSubmitArgs(args)
					const adapter = await (deps.createAdapter ?? createDefaultBridgeAdapter)({
						from: commandArgs.from,
						to: commandArgs.to,
						verbose: commandArgs.verbose ?? false
					})
					const result = await runWithdrawalSubmit(commandArgs, {
						adapter,
						sleep: deps.sleep,
						retryDelayMs: deps.retryDelayMs
					})
					writeResult({ json: commandArgs.json, result, write: deps.write ?? console.log })
				}
			}),
			finalize: defineCommand({
				meta: {
					name: "finalize",
					description: "Finalize the next eligible withdrawal."
				},
				args: {
					...routeArgs({ from: "zeko:testnet", to: "mina:testnet" }),
					account: { type: "string", required: false },
					wait: { type: "boolean", default: true }
				},
				async run({ args }) {
					const commandArgs = readWithdrawalActionArgs(args)
					const adapter = await (deps.createAdapter ?? createDefaultBridgeAdapter)({
						from: commandArgs.from,
						to: commandArgs.to,
						verbose: commandArgs.verbose ?? false
					})
					const result = await runWithdrawalFinalize(commandArgs, { adapter })
					writeResult({ json: commandArgs.json, result, write: deps.write ?? console.log })
				}
			}),
			status: defineCommand({
				meta: {
					name: "status",
					description: "List withdrawal operations for an account."
				},
				args: {
					...routeArgs({ from: "zeko:testnet", to: "mina:testnet" }),
					account: { type: "string", required: false },
					latest: { type: "boolean", default: true }
				},
				async run({ args }) {
					const commandArgs = readWithdrawalStatusArgs(args)
					const adapter = await (deps.createAdapter ?? createDefaultBridgeAdapter)({
						from: commandArgs.from,
						to: commandArgs.to,
						verbose: commandArgs.verbose ?? false
					})
					const result = await runWithdrawalStatus(commandArgs, { adapter })
					writeResult({ json: commandArgs.json, result, write: deps.write ?? console.log })
				}
			})
		}
	})
