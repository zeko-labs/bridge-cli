import type { BridgeAdapter } from "./adapter"
import type { BridgeStatusSourceSnapshot, WithdrawalStatus } from "./types"

export const formatStatusEndpoints = (
	snapshot: BridgeStatusSourceSnapshot | undefined
): string | undefined =>
	snapshot?.sources.map((source) => `${source.name}=${source.endpoint}`).join(", ")

export const getWithdrawalStatusSourceSnapshot = ({
	adapter,
	statuses,
	submitHash
}: {
	adapter: Partial<Pick<BridgeAdapter, "getStatusSources">>
	statuses: WithdrawalStatus[]
	submitHash?: string
}): BridgeStatusSourceSnapshot | undefined => {
	const sources = adapter.getStatusSources?.().withdrawals ?? []
	if (sources.length === 0) return undefined

	return {
		sources,
		observedCount: statuses.length,
		...(submitHash
			? { submitHash, submitObserved: statuses.some((status) => status.hash === submitHash) }
			: {}),
		observedHashes: statuses.map((status) => status.hash)
	}
}

export const toWithdrawalStatusSourceLogDetails = (
	snapshot: BridgeStatusSourceSnapshot | undefined
): Record<string, unknown> => ({
	statusEndpoints: formatStatusEndpoints(snapshot),
	withdrawalStatusCount: snapshot?.observedCount,
	submitObserved: snapshot?.submitObserved,
	observedWithdrawalHashes:
		snapshot?.observedHashes && snapshot.observedHashes.length > 0
			? snapshot.observedHashes.join(",")
			: undefined
})
