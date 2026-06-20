import type { BridgeAdapter } from "./adapter"
import type { BridgeEndpointOverrides } from "./endpoint-overrides"
import { resolveRoute, type ChainRef } from "./routes"

export type BridgeAdapterFactory = (input: {
	from: ChainRef
	to: ChainRef
	verbose: boolean
	endpointOverrides?: BridgeEndpointOverrides
}) => Promise<BridgeAdapter> | BridgeAdapter

export const createDefaultBridgeAdapter: BridgeAdapterFactory = async ({
	from,
	to,
	verbose,
	endpointOverrides
}) => {
	const { createBridgeAdapter } = await import("./adapter")
	return createBridgeAdapter({ route: resolveRoute(from, to), verbose, endpointOverrides })
}
