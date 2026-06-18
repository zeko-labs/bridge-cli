import type { Config } from "@zeko-labs/bridge-sdk"
import {
	BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK,
	formatBridgeRoute,
	MINA_NETWORKS,
	ZEKO_M_NETWORKS
} from "@zeko/networks"
import type { RouteDescriptor } from "./routes"

const CONFIG_BY_ROUTE: Partial<Record<RouteDescriptor["route"], Config>> = {
	[formatBridgeRoute(MINA_NETWORKS.testnet, ZEKO_M_NETWORKS.testnet)]:
		BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.testnet],
	[formatBridgeRoute(ZEKO_M_NETWORKS.testnet, MINA_NETWORKS.testnet)]:
		BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.testnet],
	[formatBridgeRoute(MINA_NETWORKS.mainnet, ZEKO_M_NETWORKS.mainnet)]:
		BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.mainnet],
	[formatBridgeRoute(ZEKO_M_NETWORKS.mainnet, MINA_NETWORKS.mainnet)]:
		BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.mainnet]
} as const

export const createSdkConfig = (
	route: RouteDescriptor,
	options: { verbose?: boolean } = {}
): Config => {
	if (!route.enabled) {
		throw new Error(route.reason ?? `Bridge route ${route.label} is not enabled.`)
	}

	const config = CONFIG_BY_ROUTE[route.route]
	if (config !== undefined) {
		return {
			...config,
			verbose: options.verbose === true
		}
	}

	throw new Error(`Unsupported network pairing for ${route.label}`)
}
