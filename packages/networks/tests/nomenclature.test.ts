import { describe, expect, it } from "vitest"
import {
	AURO_NETWORK_LABELS,
	AURO_NETWORKS,
	AURO_ZEKO_NETWORKS,
	BRIDGE_CLI_ROUTES,
	BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK,
	BRIDGE_UI_NETWORKS,
	bridgeNetworkToWalletNetwork,
	createExplorerUrl,
	ETHEREUM_NETWORKS,
	formatBridgeRoute,
	formatUserFacingNetworkLabel,
	isMainnetBridgeNetwork,
	isMinaBridgeNetwork,
	isZekoBridgeCliNetwork,
	isZekoBridgeNetwork,
	NETWORK_LABELS,
	normalizeLegacyNetworkId,
	USER_FACING_NETWORK_LABELS,
	walletNetworkToBridgeNetwork,
	ZEKO_E_NETWORKS,
	ZEKO_M_NETWORKS,
	ZEKO_MAINNET_SDK_NETWORK
} from "../src"

describe("network nomenclature", () => {
	it("uses colon-form Zeko network IDs", () => {
		expect(ZEKO_M_NETWORKS).toEqual({
			local: "zeko-m:local",
			testnet: "zeko-m:testnet",
			alphanet: "zeko-m:alphanet",
			mainnet: "zeko-m:mainnet"
		})
		expect(BRIDGE_UI_NETWORKS).toEqual([
			"mina:devnet",
			"zeko-m:testnet",
			"mina:mainnet",
			"zeko-m:mainnet"
		])
	})

	it("derives route keys from constants", () => {
		expect(formatBridgeRoute("mina:testnet", ZEKO_M_NETWORKS.testnet)).toBe(
			"mina:testnet->zeko-m:testnet"
		)
		expect(BRIDGE_CLI_ROUTES.map((route) => route.route)).toContain("eth:testnet->zeko-e:testnet")
	})

	it("keeps finite labels in a dictionary", () => {
		expect(NETWORK_LABELS[ZEKO_M_NETWORKS.testnet]).toBe("Zeko-M Testnet")
		expect(NETWORK_LABELS["zeko:testnet"]).toBe("Zeko-M Testnet")
	})

	it("has a single user-facing display helper for Zeko network names", () => {
		expect(formatUserFacingNetworkLabel(ZEKO_M_NETWORKS.mainnet)).toBe(
			USER_FACING_NETWORK_LABELS[ZEKO_M_NETWORKS.mainnet]
		)
		expect(formatUserFacingNetworkLabel(AURO_ZEKO_NETWORKS.mainnet)).toBe(
			USER_FACING_NETWORK_LABELS[AURO_ZEKO_NETWORKS.mainnet]
		)
		expect(formatUserFacingNetworkLabel(ZEKO_M_NETWORKS.testnet)).toBe(
			USER_FACING_NETWORK_LABELS[ZEKO_M_NETWORKS.testnet]
		)
		expect(NETWORK_LABELS[ZEKO_M_NETWORKS.mainnet]).toBe("Zeko-M Mainnet")
	})

	it("owns Auro wallet user-facing labels", () => {
		expect(AURO_NETWORKS.zekoMainnet).toBe(AURO_ZEKO_NETWORKS.mainnet)
		expect(AURO_NETWORK_LABELS[AURO_NETWORKS.zekoMainnet]).toBe(
			formatUserFacingNetworkLabel(AURO_NETWORKS.zekoMainnet)
		)
		expect(AURO_NETWORK_LABELS[AURO_NETWORKS.zekoTestnet]).toBe(
			formatUserFacingNetworkLabel(AURO_NETWORKS.zekoTestnet)
		)
	})

	it("normalizes legacy Zeko network IDs at compatibility boundaries", () => {
		expect(normalizeLegacyNetworkId("zeko-testnet")).toBe(ZEKO_M_NETWORKS.testnet)
		expect(normalizeLegacyNetworkId("zeko:testnet")).toBe(ZEKO_M_NETWORKS.testnet)
		expect(normalizeLegacyNetworkId("zeko:mainnet")).toBe(ZEKO_M_NETWORKS.mainnet)
		expect(normalizeLegacyNetworkId("zeko:zeko-mainnet")).toBe(ZEKO_M_NETWORKS.mainnet)
		expect(normalizeLegacyNetworkId("mina:testnet")).toBe("mina:testnet")
	})

	it("owns the bridge UI network predicates", () => {
		expect(isMinaBridgeNetwork("mina:devnet")).toBe(true)
		expect(isMinaBridgeNetwork(ZEKO_M_NETWORKS.testnet)).toBe(false)
		expect(isZekoBridgeNetwork(ZEKO_M_NETWORKS.testnet)).toBe(true)
		expect(isZekoBridgeNetwork("mina:mainnet")).toBe(false)
		expect(isMainnetBridgeNetwork(ZEKO_M_NETWORKS.mainnet)).toBe(true)
		expect(isMainnetBridgeNetwork("mina:devnet")).toBe(false)
	})

	it("owns the bridge CLI Zeko network predicate", () => {
		expect(isZekoBridgeCliNetwork(ZEKO_M_NETWORKS.testnet)).toBe(true)
		expect(isZekoBridgeCliNetwork(ZEKO_E_NETWORKS.mainnet)).toBe(true)
		expect(isZekoBridgeCliNetwork(ETHEREUM_NETWORKS.testnet)).toBe(false)
		expect(isZekoBridgeCliNetwork("mina:testnet")).toBe(false)
	})

	it("owns Auro wallet compatibility network conversion", () => {
		expect(walletNetworkToBridgeNetwork(AURO_ZEKO_NETWORKS.testnet)).toBe(ZEKO_M_NETWORKS.testnet)
		expect(walletNetworkToBridgeNetwork(AURO_ZEKO_NETWORKS.mainnet)).toBe(ZEKO_M_NETWORKS.mainnet)
		expect(walletNetworkToBridgeNetwork("mina:devnet")).toBe("mina:devnet")
		expect(bridgeNetworkToWalletNetwork(ZEKO_M_NETWORKS.testnet)).toBe(AURO_ZEKO_NETWORKS.testnet)
		expect(bridgeNetworkToWalletNetwork(ZEKO_M_NETWORKS.mainnet)).toBe(AURO_ZEKO_NETWORKS.mainnet)
		expect(bridgeNetworkToWalletNetwork("mina:mainnet")).toBe("mina:mainnet")
	})

	it("keeps the backend SDK mainnet network ID explicit", () => {
		expect(BRIDGE_SDK_CONFIG_BY_ZEKO_M_NETWORK[ZEKO_M_NETWORKS.mainnet].l2Network).toEqual(
			ZEKO_MAINNET_SDK_NETWORK
		)
	})

	it("creates explorer URLs for Zeko-M networks", () => {
		expect(createExplorerUrl(ZEKO_M_NETWORKS.testnet, "5Jhash")).toBe(
			"https://zekoscan.io/testnet/tx/5Jhash"
		)
	})
})
