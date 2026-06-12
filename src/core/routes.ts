export type ChainFamily = "mina" | "zeko" | "eth"
export type ChainRef =
	| "mina:testnet"
	| "mina:mainnet"
	| "zeko:testnet"
	| "zeko:zeko-mainnet"
	| "eth:testnet"
	| "eth:mainnet"
export type Direction = "deposit" | "withdrawal"

export type RouteDescriptor = {
	from: ChainRef
	to: ChainRef
	enabled: boolean
	direction: Direction
	label: string
	reason?: string
}

export const KNOWN_ROUTES: RouteDescriptor[] = [
	{
		from: "mina:testnet",
		to: "zeko:testnet",
		enabled: true,
		direction: "deposit",
		label: "Mina testnet -> Zeko testnet"
	},
	{
		from: "zeko:testnet",
		to: "mina:testnet",
		enabled: true,
		direction: "withdrawal",
		label: "Zeko testnet -> Mina testnet"
	},
	{
		from: "mina:mainnet",
		to: "zeko:zeko-mainnet",
		enabled: true,
		direction: "deposit",
		label: "Mina mainnet -> Zeko mainnet"
	},
	{
		from: "zeko:zeko-mainnet",
		to: "mina:mainnet",
		enabled: true,
		direction: "withdrawal",
		label: "Zeko mainnet -> Mina mainnet"
	},
	{
		from: "eth:testnet",
		to: "zeko:testnet",
		enabled: false,
		direction: "deposit",
		label: "Ethereum testnet -> Zeko testnet",
		reason: "Known route, not enabled yet."
	},
	{
		from: "zeko:testnet",
		to: "eth:testnet",
		enabled: false,
		direction: "withdrawal",
		label: "Zeko testnet -> Ethereum testnet",
		reason: "Known route, not enabled yet."
	},
	{
		from: "eth:mainnet",
		to: "zeko:zeko-mainnet",
		enabled: false,
		direction: "deposit",
		label: "Ethereum mainnet -> Zeko mainnet",
		reason: "Known route, not enabled yet."
	},
	{
		from: "zeko:zeko-mainnet",
		to: "eth:mainnet",
		enabled: false,
		direction: "withdrawal",
		label: "Zeko mainnet -> Ethereum mainnet",
		reason: "Known route, not enabled yet."
	}
]

export const CHAIN_REFS: ChainRef[] = [
	...new Set(KNOWN_ROUTES.flatMap(({ from, to }) => [from, to]))
]

export const isChainRef = (value: string): value is ChainRef =>
	CHAIN_REFS.includes(value as ChainRef)

export const parseChainRef = (value: unknown, flag: string): ChainRef => {
	if (typeof value !== "string" || !isChainRef(value)) {
		throw new Error(`Invalid ${flag} chain: ${String(value)}`)
	}

	return value
}

export const parseRouteString = (value: string): [ChainRef, ChainRef] => {
	const [from, to] = value.split("->")
	if (typeof from !== "string" || typeof to !== "string" || !isChainRef(from) || !isChainRef(to)) {
		throw new Error(`Invalid persisted route: ${value}`)
	}

	return [from, to]
}

export const formatRoute = (from: ChainRef, to: ChainRef): `${ChainRef}->${ChainRef}` =>
	`${from}->${to}`

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
