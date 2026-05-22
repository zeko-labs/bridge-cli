import { describe, expect, it } from "vitest"
import { resolveRoute } from "../src/core/routes"
import { createSdkConfig } from "../src/core/sdk-config"

describe("sdk config", () => {
	it("maps the supported testnet route to bridge-sdk endpoints", () => {
		const config = createSdkConfig(resolveRoute("mina:testnet", "zeko:testnet"))

		expect(config.l1Url).toBe("https://gateway.mina.devnet.zeko.io")
		expect(config.l1ArchiveUrl).toBe("https://gateway.mina.archive.devnet.zeko.io")
		expect(config.zekoUrl).toBe("https://testnet.zeko.io/graphql")
		expect(config.zekoArchiveUrl).toBe("https://archive.testnet.zeko.io/graphql")
		expect(config.actionsApi).toBe("https://api.actions.zeko.io/graphql")
		expect(config.l1Network).toBe("testnet")
		expect(config.l2Network).toBe("testnet")
		expect(config.verbose).toBe(false)
	})

	it("can enable verbose sdk logging explicitly", () => {
		const config = createSdkConfig(resolveRoute("mina:testnet", "zeko:testnet"), {
			verbose: true
		})

		expect(config.verbose).toBe(true)
	})

	it("rejects disabled routes", () => {
		expect(() => createSdkConfig(resolveRoute("mina:mainnet", "zeko:mainnet"))).toThrowError(
			"Known route, not enabled yet."
		)
	})
})
