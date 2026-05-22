import { Bridge } from "@zeko-labs/bridge-sdk"
import {
	PrivateKey,
	PublicKey,
	type Transaction as MinaTransaction,
	UInt32,
	UInt64,
	fetchTransactionStatus
} from "o1js"
import { createExplorerUrl } from "./explorer"
import { minaStringToNanomina, nanominaToMinaString } from "./format"
import type { ChainRef, Direction, RouteDescriptor } from "./routes"
import { createSdkConfig } from "./sdk-config"
import { resolveSignerKeys } from "./signer"
import { resolveDepositTimeoutSlots } from "./timeouts"
import type {
	BridgeCapabilityDiagnostic,
	BridgeStatusSources,
	DepositStatus,
	TransactionResult,
	WithdrawalStatus
} from "./types"

export type BridgeAdapter = {
	getStatusSources?(): BridgeStatusSources
	getDepositStatuses(account: string): Promise<DepositStatus[]>
	getWithdrawalStatuses(account: string): Promise<WithdrawalStatus[]>
	canFinalizeDeposit?(account?: string): Promise<boolean | BridgeCapabilityDiagnostic>
	canCancelDeposit?(account?: string): Promise<boolean | BridgeCapabilityDiagnostic>
	canFinalizeWithdrawal?(account?: string): Promise<boolean | BridgeCapabilityDiagnostic>
	submitDeposit(input: {
		account?: string
		recipient?: string
		amount: string
		timeoutSlots?: number
		wait: boolean
	}): Promise<TransactionResult>
	finalizeDeposit(input: { account?: string; wait: boolean }): Promise<TransactionResult>
	cancelDeposit(input: { account?: string; wait: boolean }): Promise<TransactionResult>
	submitWithdrawal(input: {
		account?: string
		recipient?: string
		amount: string
		wait: boolean
	}): Promise<TransactionResult>
	finalizeWithdrawal(input: { account?: string; wait: boolean }): Promise<TransactionResult>
}

const bridges = new Map<string, Promise<Bridge>>()
const BRIDGE_FEE_NANOMINA = 100_000_000n
const WITHDRAWAL_SUBMIT_FEE_NANOMINA = 500_000_000n
export const MAX_FEE_RETRIES = 5
export const normalizeStatusTimestamp = (timestamp: string): string =>
	timestamp === "0" ? "" : timestamp

type SignedTransactionResult = {
	hash?: string
	data?: {
		sendZkapp?: {
			zkapp?: {
				id?: string
			}
		}
	}
}

const routeKey = (route: RouteDescriptor, verbose: boolean) =>
	`${route.from}->${route.to}:verbose=${verbose ? "1" : "0"}`

const getBridge = (route: RouteDescriptor, verbose: boolean) => {
	const key = routeKey(route, verbose)
	const cached = bridges.get(key)
	if (cached) return cached

	const bridge = Bridge.init(createSdkConfig(route, { verbose })).catch((error: unknown) => {
		bridges.delete(key)
		throw error
	})
	bridges.set(key, bridge)
	return bridge
}

const resolvePublicKey = ({
	account,
	keys,
	network
}: {
	account?: string
	keys: ReturnType<typeof resolveSignerKeys>
	network: ChainRef
}): { publicKey: PublicKey; signer: PrivateKey } => {
	const secret = network.startsWith("zeko:")
		? keys.zeko
		: network.startsWith("eth:")
			? keys.eth
			: keys.mina

	if (!secret) {
		throw new Error(`Missing required signer private key for ${network}`)
	}

	const signer = PrivateKey.fromBase58(secret)
	const fallback = signer.toPublicKey().toBase58()
	return {
		publicKey: PublicKey.fromBase58(account ?? fallback),
		signer
	}
}

const waitForTransactionInclusion = async ({
	zkAppId,
	graphqlUrl
}: {
	zkAppId?: string
	graphqlUrl: string
}): Promise<boolean> => {
	if (!zkAppId) return false

	for (;;) {
		try {
			const status = await fetchTransactionStatus(zkAppId, graphqlUrl)
			if (status === "INCLUDED") return true
			if (status !== "PENDING") return false
			await new Promise((resolve) => setTimeout(resolve, 2_000))
		} catch {
			return false
		}
	}
}

const isFeeTooLowError = (error: unknown): boolean => String(error).includes("Fee is too low")

export const sendWithFeeRetries = async <TTransaction, TResult>({
	createTransaction,
	initialFeeNanomina,
	sendTransaction
}: {
	createTransaction: (feeNanomina: bigint) => Promise<TTransaction>
	initialFeeNanomina: bigint
	sendTransaction: (transaction: TTransaction) => Promise<TResult>
}): Promise<TResult> => {
	let feeNanomina = initialFeeNanomina
	let retryCount = 0

	for (;;) {
		try {
			const transaction = await createTransaction(feeNanomina)
			return await sendTransaction(transaction)
		} catch (error) {
			if (!isFeeTooLowError(error) || retryCount >= MAX_FEE_RETRIES) {
				throw error
			}

			retryCount += 1
			feeNanomina *= 2n
		}
	}
}

const signSdkTransaction =
	(signer: PrivateKey) =>
	async (transaction: MinaTransaction<boolean, false>): Promise<MinaTransaction<boolean, true>> =>
		// o1js signs in place at runtime, but the public type does not narrow the transaction's signed flag.
		transaction.sign([signer]) as MinaTransaction<boolean, true>

const toCompletedSdkTransaction = (hash: string): SignedTransactionResult => ({ hash })

const useCompletedSdkTransaction = async (
	transaction: SignedTransactionResult
): Promise<SignedTransactionResult> => transaction

const mapDirectionNetwork = ({
	action,
	route
}: {
	action: "submit" | "finalize" | "cancel"
	route: RouteDescriptor
}): ChainRef => {
	if (route.direction === "deposit") {
		if (action === "submit" || action === "cancel") return route.from
		return route.to
	}

	if (action === "submit") return route.from
	return route.to
}

const graphqlUrlForAction = ({
	action,
	route
}: {
	action: "submit" | "finalize" | "cancel"
	route: RouteDescriptor
}): string => {
	const config = createSdkConfig(route)
	return mapDirectionNetwork({ action, route }).startsWith("zeko:") ? config.zekoUrl : config.l1Url
}

const normalizeTxResult = async ({
	action,
	direction,
	route,
	result,
	wait
}: {
	action: "submit" | "finalize" | "cancel"
	direction: Direction
	route: RouteDescriptor
	result: SignedTransactionResult
	wait: boolean
}): Promise<TransactionResult> => {
	const hash = result.hash
	if (!hash) {
		throw new Error(`Transaction ${direction}:${action} did not return a hash`)
	}

	const zkAppId = result.data?.sendZkapp?.zkapp?.id
	const network = mapDirectionNetwork({ action, route })

	return {
		success: true,
		direction,
		action,
		route: `${route.from}->${route.to}`,
		hash,
		explorerUrl: createExplorerUrl(network, hash),
		included: wait
			? await waitForTransactionInclusion({
					zkAppId,
					graphqlUrl: graphqlUrlForAction({ action, route })
				})
			: false,
		zkAppId
	}
}

export const createBridgeAdapter = ({
	route,
	env = process.env,
	verbose = false
}: {
	route: RouteDescriptor
	env?: Partial<Record<string, string | undefined>>
	verbose?: boolean
}): BridgeAdapter => {
	const keys = resolveSignerKeys(env)
	const config = createSdkConfig(route)

	return {
		getStatusSources() {
			return {
				deposits: [
					{
						name: "l1-archive",
						endpoint: config.l1ArchiveUrl,
						role: "archived Mina deposit actions"
					},
					{
						name: "l1-live",
						endpoint: config.l1Url,
						role: "recent live Mina deposit actions"
					}
				],
				withdrawals: [
					{
						name: "l2-archive",
						endpoint: config.zekoArchiveUrl,
						role: "archived Zeko withdrawal actions"
					},
					{
						name: "l2-live",
						endpoint: config.zekoUrl,
						role: "recent live Zeko withdrawal actions"
					}
				]
			}
		},
		async getDepositStatuses(account) {
			const bridge = await getBridge(route, verbose)
			const result = await bridge.fetchDepositsWithStates(PublicKey.fromBase58(account))
			return result.deposits.map(
				(item): DepositStatus => ({
					index: item.index,
					amount: nanominaToMinaString(item.amount.toBigInt()),
					recipient: item.recipient.toBase58(),
					cancelled: item.cancelled,
					cancellable: item.cancellable,
					synced: item.synced,
					accepted: item.accepted,
					confirmed: item.confirmed,
					finalised: item.finalised,
					hash: item.hash,
					timestamp: normalizeStatusTimestamp(item.timestamp)
				})
			)
		},
		async getWithdrawalStatuses(account) {
			const bridge = await getBridge(route, verbose)
			const result = await bridge.fetchWithdrawalsWithStates(PublicKey.fromBase58(account))
			return result.withdrawals.map(
				(item): WithdrawalStatus => ({
					index: item.index,
					amount: nanominaToMinaString(item.amount.toBigInt()),
					recipient: item.recipient.toBase58(),
					committed: item.committed,
					finalised: item.finalised,
					hash: item.hash,
					timestamp: normalizeStatusTimestamp(item.timestamp)
				})
			)
		},
		async submitDeposit({ account, recipient, amount, timeoutSlots, wait }) {
			const bridge = await getBridge(route, verbose)
			const { publicKey, signer } = resolvePublicKey({ account, keys, network: route.from })
			const { publicKey: recipientPublicKey } = resolvePublicKey({
				account: recipient,
				keys,
				network: route.to
			})
			const currentSlot = await bridge.fetchCurrentSlot()
			const timeout = currentSlot.add(UInt32.from(resolveDepositTimeoutSlots(timeoutSlots)))
			const result = await sendWithFeeRetries<SignedTransactionResult, SignedTransactionResult>({
				initialFeeNanomina: BRIDGE_FEE_NANOMINA,
				sendTransaction: useCompletedSdkTransaction,
				createTransaction: async (feeNanomina) =>
					toCompletedSdkTransaction(
						await bridge.submitDeposit(
							{ sender: publicKey, fee: Number(feeNanomina) },
							{
								recipient: recipientPublicKey,
								amount: UInt64.from(minaStringToNanomina(amount)),
								timeout
							},
							signSdkTransaction(signer)
						)
					)
			})
			return normalizeTxResult({ action: "submit", direction: "deposit", route, result, wait })
		},
		async canFinalizeDeposit(account) {
			const bridge = await getBridge(route, verbose)
			const { publicKey } = resolvePublicKey({ account, keys, network: route.to })
			return bridge.canFinalizeDeposit(publicKey)
		},
		async canCancelDeposit(account) {
			const bridge = await getBridge(route, verbose)
			const { publicKey } = resolvePublicKey({ account, keys, network: route.from })
			return bridge.canCancelDeposit(publicKey)
		},
		async finalizeDeposit({ account, wait }) {
			const bridge = await getBridge(route, verbose)
			const { publicKey, signer } = resolvePublicKey({ account, keys, network: route.to })
			const result = await sendWithFeeRetries<SignedTransactionResult, SignedTransactionResult>({
				initialFeeNanomina: BRIDGE_FEE_NANOMINA,
				sendTransaction: useCompletedSdkTransaction,
				createTransaction: async (feeNanomina) =>
					toCompletedSdkTransaction(
						await bridge.finalizeDeposit(publicKey, signSdkTransaction(signer), { feeNanomina })
					)
			})
			return normalizeTxResult({ action: "finalize", direction: "deposit", route, result, wait })
		},
		async cancelDeposit({ account, wait }) {
			const bridge = await getBridge(route, verbose)
			const { publicKey, signer } = resolvePublicKey({ account, keys, network: route.from })
			const result = await sendWithFeeRetries<SignedTransactionResult, SignedTransactionResult>({
				initialFeeNanomina: BRIDGE_FEE_NANOMINA,
				sendTransaction: useCompletedSdkTransaction,
				createTransaction: async (feeNanomina) =>
					toCompletedSdkTransaction(
						await bridge.cancelDeposit(publicKey, signSdkTransaction(signer), undefined, {
							feeNanomina
						})
					)
			})
			return normalizeTxResult({ action: "cancel", direction: "deposit", route, result, wait })
		},
		async submitWithdrawal({ account, recipient, amount, wait }) {
			const bridge = await getBridge(route, verbose)
			const { publicKey, signer } = resolvePublicKey({ account, keys, network: route.from })
			const { publicKey: recipientPublicKey } = resolvePublicKey({
				account: recipient,
				keys,
				network: route.to
			})
			const result = await sendWithFeeRetries<SignedTransactionResult, SignedTransactionResult>({
				initialFeeNanomina: WITHDRAWAL_SUBMIT_FEE_NANOMINA,
				sendTransaction: useCompletedSdkTransaction,
				createTransaction: async (feeNanomina) =>
					toCompletedSdkTransaction(
						await bridge.submitWithdrawal(
							{ sender: publicKey, fee: Number(feeNanomina) },
							{
								recipient: recipientPublicKey,
								amount: UInt64.from(minaStringToNanomina(amount))
							},
							signSdkTransaction(signer)
						)
					)
			})
			return normalizeTxResult({ action: "submit", direction: "withdrawal", route, result, wait })
		},
		async canFinalizeWithdrawal(account) {
			const bridge = await getBridge(route, verbose)
			const { publicKey } = resolvePublicKey({ account, keys, network: route.to })
			return bridge.canFinalizeWithdrawal(publicKey)
		},
		async finalizeWithdrawal({ account, wait }) {
			const bridge = await getBridge(route, verbose)
			const { publicKey, signer } = resolvePublicKey({ account, keys, network: route.to })
			const result = await sendWithFeeRetries<SignedTransactionResult, SignedTransactionResult>({
				initialFeeNanomina: BRIDGE_FEE_NANOMINA,
				sendTransaction: useCompletedSdkTransaction,
				createTransaction: async (feeNanomina) =>
					toCompletedSdkTransaction(
						await bridge.finalizeWithdrawal(publicKey, signSdkTransaction(signer), undefined, {
							feeNanomina
						})
					)
			})
			return normalizeTxResult({
				action: "finalize",
				direction: "withdrawal",
				route,
				result,
				wait
			})
		}
	}
}
