import { describe, expect, it } from "vitest"
import { KNOWN_ROUTES, resolveRoute } from "../src/core/routes"

describe("routes", () => {
	it("marks mina testnet to zeko testnet as supported", () => {
		expect(resolveRoute("mina:testnet", "zeko:testnet").enabled).toBe(true)
	})

	it("enables mina and zeko mainnet routes", () => {
		expect(resolveRoute("mina:mainnet", "zeko:mainnet").enabled).toBe(true)
		expect(resolveRoute("zeko:mainnet", "mina:mainnet").enabled).toBe(true)
	})

	it("keeps ethereum routes known but disabled", () => {
		expect(resolveRoute("eth:testnet", "zeko:testnet").enabled).toBe(false)
		expect(KNOWN_ROUTES.length).toBeGreaterThanOrEqual(4)
	})
})
