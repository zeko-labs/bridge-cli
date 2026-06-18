import { describe, expect, it } from "vitest"
import { KNOWN_ROUTES, parseChainRef, parseRouteString, resolveRoute } from "../src/core/routes"

describe("routes", () => {
	it("marks mina testnet to Zeko-M testnet as supported", () => {
		expect(resolveRoute("mina:testnet", "zeko-m:testnet").enabled).toBe(true)
	})

	it("enables mina and Zeko-M mainnet routes", () => {
		expect(resolveRoute("mina:mainnet", "zeko-m:mainnet").enabled).toBe(true)
		expect(resolveRoute("zeko-m:mainnet", "mina:mainnet").enabled).toBe(true)
	})

	it("keeps ethereum routes known but disabled", () => {
		expect(resolveRoute("eth:testnet", "zeko-e:testnet").enabled).toBe(false)
		expect(KNOWN_ROUTES.length).toBeGreaterThanOrEqual(4)
	})

	it("normalizes legacy persisted Zeko route IDs", () => {
		expect(parseRouteString("mina:testnet->zeko:testnet")).toEqual([
			"mina:testnet",
			"zeko-m:testnet"
		])
		expect(parseRouteString("zeko:zeko-mainnet->mina:mainnet")).toEqual([
			"zeko-m:mainnet",
			"mina:mainnet"
		])
	})

	it("normalizes legacy Zeko chain flags", () => {
		expect(parseChainRef("zeko:testnet", "--to")).toBe("zeko-m:testnet")
		expect(parseChainRef("zeko:zeko-mainnet", "--from")).toBe("zeko-m:mainnet")
	})
})
