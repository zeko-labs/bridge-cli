export const MINA_NETWORKS = {
	devnet: "mina:devnet",
	testnet: "mina:testnet",
	mainnet: "mina:mainnet"
} as const

export const ETHEREUM_NETWORKS = {
	testnet: "eth:testnet",
	mainnet: "eth:mainnet"
} as const

export const ZEKO_M_NETWORKS = {
	local: "zeko-m:local",
	testnet: "zeko-m:testnet",
	alphanet: "zeko-m:alphanet",
	mainnet: "zeko-m:mainnet"
} as const

export const ZEKO_E_NETWORKS = {
	testnet: "zeko-e:testnet",
	mainnet: "zeko-e:mainnet"
} as const

export const AURO_ZEKO_NETWORKS = {
	testnet: "zeko:testnet",
	mainnet: "zeko:mainnet"
} as const

export const AURO_NETWORKS = {
	minaDevnet: MINA_NETWORKS.devnet,
	minaMainnet: MINA_NETWORKS.mainnet,
	zekoTestnet: AURO_ZEKO_NETWORKS.testnet,
	zekoMainnet: AURO_ZEKO_NETWORKS.mainnet
} as const satisfies Record<string, AuroWalletNetwork>

export const LEGACY_ZEKO_M_NETWORKS = {
	testnet: "zeko:testnet",
	mainnet: "zeko:mainnet"
} as const

export const LEGACY_NETWORK_ALIASES = {
	"zeko-testnet": ZEKO_M_NETWORKS.testnet,
	"zeko-mainnet": ZEKO_M_NETWORKS.mainnet,
	[LEGACY_ZEKO_M_NETWORKS.testnet]: ZEKO_M_NETWORKS.testnet,
	[LEGACY_ZEKO_M_NETWORKS.mainnet]: ZEKO_M_NETWORKS.mainnet,
	"zeko:zeko-mainnet": ZEKO_M_NETWORKS.mainnet
} as const

export type ObjectValue<T> = T[keyof T]
export type MinaNetwork = ObjectValue<typeof MINA_NETWORKS>
export type EthereumNetwork = ObjectValue<typeof ETHEREUM_NETWORKS>
export type ZekoMNetwork = ObjectValue<typeof ZEKO_M_NETWORKS>
export type ZekoENetwork = ObjectValue<typeof ZEKO_E_NETWORKS>
export type AuroZekoNetwork = ObjectValue<typeof AURO_ZEKO_NETWORKS>
export type LegacyZekoMNetwork = ObjectValue<typeof LEGACY_ZEKO_M_NETWORKS>
export type LegacyNetwork = keyof typeof LEGACY_NETWORK_ALIASES
export type ZekoNetwork = ZekoMNetwork | ZekoENetwork
export type ChainNetwork = MinaNetwork | EthereumNetwork | ZekoNetwork
export type WalletZekoNetwork = AuroZekoNetwork
export type DisplayNetwork = ChainNetwork | WalletZekoNetwork

export type ZekoMBridgeNetwork = typeof ZEKO_M_NETWORKS.testnet | typeof ZEKO_M_NETWORKS.mainnet
export type BridgeUiNetwork =
	| typeof MINA_NETWORKS.devnet
	| typeof MINA_NETWORKS.mainnet
	| ZekoMBridgeNetwork
export type AuroWalletNetwork =
	| typeof MINA_NETWORKS.devnet
	| typeof MINA_NETWORKS.mainnet
	| AuroZekoNetwork
export type BridgeCliNetwork =
	| typeof MINA_NETWORKS.testnet
	| typeof MINA_NETWORKS.mainnet
	| typeof ETHEREUM_NETWORKS.testnet
	| typeof ETHEREUM_NETWORKS.mainnet
	| ZekoMBridgeNetwork
	| typeof ZEKO_E_NETWORKS.testnet
	| typeof ZEKO_E_NETWORKS.mainnet
export type BridgeRouteKey<Network extends string = ChainNetwork> = `${Network}->${Network}`
export type BridgeDirection = "deposit" | "withdrawal"

export type BridgeRouteDescriptor<Network extends string = ChainNetwork> = {
	from: Network
	to: Network
	route: BridgeRouteKey<Network>
	enabled: boolean
	direction: BridgeDirection
	label: string
	reason?: string
}

export const normalizeLegacyNetworkId = (network: string) =>
	LEGACY_NETWORK_ALIASES[network as LegacyNetwork] ?? network

export const NETWORK_LABELS = {
	[MINA_NETWORKS.devnet]: "Mina Devnet",
	[MINA_NETWORKS.testnet]: "Mina Testnet",
	[MINA_NETWORKS.mainnet]: "Mina Mainnet",
	[ETHEREUM_NETWORKS.testnet]: "Ethereum Testnet",
	[ETHEREUM_NETWORKS.mainnet]: "Ethereum Mainnet",
	[ZEKO_M_NETWORKS.local]: "Zeko-M Local",
	[ZEKO_M_NETWORKS.testnet]: "Zeko-M Testnet",
	[ZEKO_M_NETWORKS.alphanet]: "Zeko-M Alphanet",
	[ZEKO_M_NETWORKS.mainnet]: "Zeko-M Mainnet",
	[ZEKO_E_NETWORKS.testnet]: "Zeko-E Testnet",
	[ZEKO_E_NETWORKS.mainnet]: "Zeko-E Mainnet",
	[AURO_ZEKO_NETWORKS.testnet]: "Zeko-M Testnet",
	[AURO_ZEKO_NETWORKS.mainnet]: "Zeko-M Mainnet"
} as const satisfies Record<DisplayNetwork, string>

export const USER_FACING_NETWORK_LABELS = {
	...NETWORK_LABELS,
	[ZEKO_M_NETWORKS.local]: "Zeko Local",
	[ZEKO_M_NETWORKS.testnet]: "Zeko Testnet",
	[ZEKO_M_NETWORKS.alphanet]: "Zeko Alphanet",
	[ZEKO_M_NETWORKS.mainnet]: "Zeko Mainnet",
	[AURO_ZEKO_NETWORKS.testnet]: "Zeko Testnet",
	[AURO_ZEKO_NETWORKS.mainnet]: "Zeko Mainnet"
} as const satisfies Record<DisplayNetwork, string>

export const formatUserFacingNetworkLabel = (network: DisplayNetwork): string =>
	USER_FACING_NETWORK_LABELS[network]

export const AURO_NETWORK_LABELS = {
	[AURO_NETWORKS.minaDevnet]: formatUserFacingNetworkLabel(AURO_NETWORKS.minaDevnet),
	[AURO_NETWORKS.minaMainnet]: formatUserFacingNetworkLabel(AURO_NETWORKS.minaMainnet),
	[AURO_NETWORKS.zekoTestnet]: formatUserFacingNetworkLabel(AURO_NETWORKS.zekoTestnet),
	[AURO_NETWORKS.zekoMainnet]: formatUserFacingNetworkLabel(AURO_NETWORKS.zekoMainnet)
} as const satisfies Record<AuroWalletNetwork, string>

export const BRIDGE_UI_NETWORKS = [
	MINA_NETWORKS.devnet,
	ZEKO_M_NETWORKS.testnet,
	MINA_NETWORKS.mainnet,
	ZEKO_M_NETWORKS.mainnet
] as const satisfies readonly BridgeUiNetwork[]

export const BRIDGE_UI_NETWORK_KINDS = {
	[MINA_NETWORKS.devnet]: "mina",
	[ZEKO_M_NETWORKS.testnet]: "zeko-m",
	[MINA_NETWORKS.mainnet]: "mina",
	[ZEKO_M_NETWORKS.mainnet]: "zeko-m"
} as const satisfies Record<BridgeUiNetwork, "mina" | "zeko-m">

export const BRIDGE_UI_NETWORK_ENVS = {
	[MINA_NETWORKS.devnet]: "testnet",
	[ZEKO_M_NETWORKS.testnet]: "testnet",
	[MINA_NETWORKS.mainnet]: "mainnet",
	[ZEKO_M_NETWORKS.mainnet]: "mainnet"
} as const satisfies Record<BridgeUiNetwork, "testnet" | "mainnet">

export const isMinaBridgeNetwork = (network: BridgeUiNetwork) =>
	BRIDGE_UI_NETWORK_KINDS[network] === "mina"

export const isZekoBridgeNetwork = (network: BridgeUiNetwork) =>
	BRIDGE_UI_NETWORK_KINDS[network] === "zeko-m"

export const isMainnetBridgeNetwork = (network: BridgeUiNetwork) =>
	BRIDGE_UI_NETWORK_ENVS[network] === "mainnet"

export const formatBridgeRoute = <From extends string, To extends string>(
	from: From,
	to: To
): `${From}->${To}` => `${from}->${to}`

const bridgeRoute = <Network extends string>({
	from,
	to,
	enabled,
	direction,
	reason
}: Omit<BridgeRouteDescriptor<Network>, "route" | "label">): BridgeRouteDescriptor<Network> => ({
	from,
	to,
	route: formatBridgeRoute(from, to),
	enabled,
	direction,
	label: `${NETWORK_LABELS[from as DisplayNetwork]} -> ${NETWORK_LABELS[to as DisplayNetwork]}`,
	...(reason === undefined ? {} : { reason })
})

export const BRIDGE_CLI_ROUTES = [
	bridgeRoute({
		from: MINA_NETWORKS.testnet,
		to: ZEKO_M_NETWORKS.testnet,
		enabled: true,
		direction: "deposit"
	}),
	bridgeRoute({
		from: ZEKO_M_NETWORKS.testnet,
		to: MINA_NETWORKS.testnet,
		enabled: true,
		direction: "withdrawal"
	}),
	bridgeRoute({
		from: MINA_NETWORKS.mainnet,
		to: ZEKO_M_NETWORKS.mainnet,
		enabled: true,
		direction: "deposit"
	}),
	bridgeRoute({
		from: ZEKO_M_NETWORKS.mainnet,
		to: MINA_NETWORKS.mainnet,
		enabled: true,
		direction: "withdrawal"
	}),
	bridgeRoute({
		from: ETHEREUM_NETWORKS.testnet,
		to: ZEKO_E_NETWORKS.testnet,
		enabled: false,
		direction: "deposit",
		reason: "Known route, not enabled yet."
	}),
	bridgeRoute({
		from: ZEKO_E_NETWORKS.testnet,
		to: ETHEREUM_NETWORKS.testnet,
		enabled: false,
		direction: "withdrawal",
		reason: "Known route, not enabled yet."
	}),
	bridgeRoute({
		from: ETHEREUM_NETWORKS.mainnet,
		to: ZEKO_E_NETWORKS.mainnet,
		enabled: false,
		direction: "deposit",
		reason: "Known route, not enabled yet."
	}),
	bridgeRoute({
		from: ZEKO_E_NETWORKS.mainnet,
		to: ETHEREUM_NETWORKS.mainnet,
		enabled: false,
		direction: "withdrawal",
		reason: "Known route, not enabled yet."
	})
] as const satisfies readonly BridgeRouteDescriptor<BridgeCliNetwork>[]

export const BRIDGE_CLI_NETWORK_KINDS = {
	[MINA_NETWORKS.testnet]: "mina",
	[MINA_NETWORKS.mainnet]: "mina",
	[ETHEREUM_NETWORKS.testnet]: "ethereum",
	[ETHEREUM_NETWORKS.mainnet]: "ethereum",
	[ZEKO_M_NETWORKS.testnet]: "zeko-m",
	[ZEKO_M_NETWORKS.mainnet]: "zeko-m",
	[ZEKO_E_NETWORKS.testnet]: "zeko-e",
	[ZEKO_E_NETWORKS.mainnet]: "zeko-e"
} as const satisfies Record<BridgeCliNetwork, "mina" | "ethereum" | "zeko-m" | "zeko-e">

export const isZekoBridgeCliNetwork = (network: BridgeCliNetwork) =>
	BRIDGE_CLI_NETWORK_KINDS[network] === "zeko-m" || BRIDGE_CLI_NETWORK_KINDS[network] === "zeko-e"

export const EXPLORER_BASE_URLS = {
	[MINA_NETWORKS.devnet]: "https://minascan.io/devnet",
	[MINA_NETWORKS.testnet]: "https://minascan.io/devnet",
	[MINA_NETWORKS.mainnet]: "https://minascan.io/mainnet",
	[ZEKO_M_NETWORKS.testnet]: "https://zekoscan.io/testnet",
	[ZEKO_M_NETWORKS.mainnet]: "https://zekoscan.io/mainnet",
	[ZEKO_E_NETWORKS.testnet]: "https://zekoscan.io/testnet",
	[ZEKO_E_NETWORKS.mainnet]: "https://zekoscan.io/mainnet",
	[ETHEREUM_NETWORKS.testnet]: "https://sepolia.etherscan.io",
	[ETHEREUM_NETWORKS.mainnet]: "https://etherscan.io"
} as const satisfies Partial<Record<ChainNetwork, string>>

export const createExplorerUrl = (network: keyof typeof EXPLORER_BASE_URLS, hash: string): string =>
	`${EXPLORER_BASE_URLS[network]}/tx/${hash}`

export type BridgeSdkNetworkId = "testnet" | "mainnet" | { custom: "zeko-mainnet" }
export type BridgeSdkConfig = {
	l1Url: string
	l1ArchiveUrl: string
	zekoUrl: string
	zekoArchiveUrl: string
	actionsApi: string
	l1Network: BridgeSdkNetworkId
	l2Network: BridgeSdkNetworkId
}

export const ZEKO_MAINNET_SDK_NETWORK = { custom: "zeko-mainnet" } as const

export const BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK = {
	[ZEKO_M_NETWORKS.testnet]: {
		l1Url: "https://gateway.mina.devnet.zeko.io",
		l1ArchiveUrl: "https://gateway.mina.archive.devnet.zeko.io",
		zekoUrl: "https://testnet.zeko.io/graphql",
		zekoArchiveUrl: "https://archive.testnet.zeko.io/graphql",
		actionsApi: "https://testnet.api.actions.zeko.io/graphql",
		l1Network: "testnet",
		l2Network: "testnet"
	},
	[ZEKO_M_NETWORKS.mainnet]: {
		l1Url: "https://gateway.mina.mainnet.zeko.io",
		l1ArchiveUrl: "https://gateway.mina.archive.mainnet.zeko.io",
		zekoUrl: "https://mainnet.zeko.io/graphql",
		zekoArchiveUrl: "https://archive.mainnet.zeko.io/graphql",
		actionsApi: "https://api.actions.zeko.io/graphql",
		l1Network: "mainnet",
		l2Network: ZEKO_MAINNET_SDK_NETWORK
	}
} as const satisfies Record<ZekoMBridgeNetwork, BridgeSdkConfig>

export const BRIDGE_UI_CONFIG_BY_ROUTE: Partial<
	Record<BridgeRouteKey<BridgeUiNetwork>, BridgeSdkConfig>
> = {
	[formatBridgeRoute(MINA_NETWORKS.devnet, ZEKO_M_NETWORKS.testnet)]:
		BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.testnet],
	[formatBridgeRoute(ZEKO_M_NETWORKS.testnet, MINA_NETWORKS.devnet)]:
		BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.testnet],
	[formatBridgeRoute(MINA_NETWORKS.mainnet, ZEKO_M_NETWORKS.mainnet)]:
		BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.mainnet],
	[formatBridgeRoute(ZEKO_M_NETWORKS.mainnet, MINA_NETWORKS.mainnet)]:
		BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.mainnet]
} as const

export const WALLET_ZEKO_NETWORK_TO_BRIDGE_NETWORK = {
	[AURO_ZEKO_NETWORKS.testnet]: ZEKO_M_NETWORKS.testnet,
	[AURO_ZEKO_NETWORKS.mainnet]: ZEKO_M_NETWORKS.mainnet
} as const satisfies Record<WalletZekoNetwork, ZekoMBridgeNetwork>

export const BRIDGE_NETWORK_TO_WALLET_ZEKO_NETWORK = {
	[ZEKO_M_NETWORKS.testnet]: AURO_ZEKO_NETWORKS.testnet,
	[ZEKO_M_NETWORKS.mainnet]: AURO_ZEKO_NETWORKS.mainnet
} as const satisfies Record<ZekoMBridgeNetwork, WalletZekoNetwork>

export const walletNetworkToBridgeNetwork = (network: AuroWalletNetwork): BridgeUiNetwork =>
	network === AURO_ZEKO_NETWORKS.testnet || network === AURO_ZEKO_NETWORKS.mainnet
		? WALLET_ZEKO_NETWORK_TO_BRIDGE_NETWORK[network]
		: network

export const bridgeNetworkToWalletNetwork = (network: BridgeUiNetwork): AuroWalletNetwork =>
	network === ZEKO_M_NETWORKS.testnet || network === ZEKO_M_NETWORKS.mainnet
		? BRIDGE_NETWORK_TO_WALLET_ZEKO_NETWORK[network]
		: network
