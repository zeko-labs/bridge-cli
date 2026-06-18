import { createExplorerUrl as createNetworkExplorerUrl } from "@zeko/networks"
import type { ChainRef } from "./routes"

export const createExplorerUrl = (network: ChainRef, hash: string): string =>
	createNetworkExplorerUrl(network, hash)
