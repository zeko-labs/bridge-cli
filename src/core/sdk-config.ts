import type { Config } from "@zeko-labs/bridge-sdk"
import type { RouteDescriptor } from "./routes"

const TESTNET_CONFIG = {
	l1Url: "https://gateway.mina.devnet.zeko.io",
	l1ArchiveUrl: "https://gateway.mina.archive.devnet.zeko.io",
	zekoUrl: "https://testnet.zeko.io/graphql",
	zekoArchiveUrl: "https://archive.testnet.zeko.io/graphql",
	// zekoUrl: "https://alphanet.zeko.io/graphql",
	// zekoArchiveUrl: "https://archive.alphanet.zeko.io/graphql",
	actionsApi: "https://testnet.api.actions.zeko.io/graphql",
	// actionsApi: "http://localhost:9100/graphql",
	l1Network: "testnet",
	l2Network: "testnet"
} as const satisfies Config

const MAINNET_CONFIG = {
	l1Url: "https://gateway.mina.mainnet.zeko.io",
	l1ArchiveUrl: "https://gateway.mina.archive.mainnet.zeko.io",
	zekoUrl: "https://mainnet.zeko.io/graphql",
	zekoArchiveUrl: "https://archive.mainnet.zeko.io/graphql",
	actionsApi: "https://api.actions.zeko.io/graphql",
	l1Network: "mainnet",
	l2Network: { custom: "zeko-mainnet" }
} as const satisfies Config

export const createSdkConfig = (
	route: RouteDescriptor,
	options: { verbose?: boolean } = {}
): Config => {
	if (!route.enabled) {
		throw new Error(route.reason ?? `Bridge route ${route.label} is not enabled.`)
	}

	if (route.from.includes("testnet") && route.to.includes("testnet")) {
		return {
			...TESTNET_CONFIG,
			verbose: options.verbose === true
		}
	}

	if (route.from.includes("mainnet") && route.to.includes("mainnet")) {
		return {
			...MAINNET_CONFIG,
			verbose: options.verbose === true
		}
	}

	throw new Error(`Unsupported network pairing for ${route.label}`)
}
