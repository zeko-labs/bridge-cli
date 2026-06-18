import {
	BRIDGE_CLI_ROUTES,
	formatBridgeRoute,
	isZekoBridgeCliNetwork,
	normalizeLegacyNetworkId,
	type BridgeCliNetwork,
	type BridgeDirection,
	type BridgeRouteDescriptor
} from "@zeko/networks"

export type ChainFamily = "mina" | "zeko" | "eth"
export type ChainRef = BridgeCliNetwork
export type Direction = BridgeDirection
export type RouteDescriptor = BridgeRouteDescriptor<ChainRef>

export const KNOWN_ROUTES = [...BRIDGE_CLI_ROUTES] as const satisfies readonly RouteDescriptor[]

export const CHAIN_REFS = [...new Set(KNOWN_ROUTES.flatMap(({ from, to }) => [from, to]))]

export const isChainRef = (value: string): value is ChainRef =>
	CHAIN_REFS.includes(value as ChainRef)

export const isZekoChainRef = isZekoBridgeCliNetwork

export const parseChainRef = (value: unknown, flag: string): ChainRef => {
	const chainRef = typeof value === "string" ? normalizeLegacyNetworkId(value) : value
	if (typeof chainRef !== "string" || !isChainRef(chainRef)) {
		throw new Error(`Invalid ${flag} chain: ${String(value)}`)
	}

	return chainRef
}

export const parseRouteString = (value: string): [ChainRef, ChainRef] => {
	const [rawFrom, rawTo] = value.split("->")
	const from = typeof rawFrom === "string" ? normalizeLegacyNetworkId(rawFrom) : rawFrom
	const to = typeof rawTo === "string" ? normalizeLegacyNetworkId(rawTo) : rawTo
	if (typeof from !== "string" || typeof to !== "string" || !isChainRef(from) || !isChainRef(to)) {
		throw new Error(`Invalid persisted route: ${value}`)
	}

	return [from, to]
}

export const formatRoute = (from: ChainRef, to: ChainRef): `${ChainRef}->${ChainRef}` =>
	formatBridgeRoute(from, to)

export class UnknownRouteError extends Error {
	constructor(from: ChainRef, to: ChainRef) {
		super(`Unknown bridge route: ${from} -> ${to}`)
		this.name = "UnknownRouteError"
	}
}

export const resolveRoute = (from: ChainRef, to: ChainRef): RouteDescriptor => {
	const route = KNOWN_ROUTES.find((candidate) => candidate.from === from && candidate.to === to)
	if (!route) throw new UnknownRouteError(from, to)
	return route
}
