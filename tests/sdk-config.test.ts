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
		expect(config.actionsApi).toBe("https://testnet.api.actions.zeko.io/graphql")
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

	it("maps the supported mainnet route to bridge-sdk endpoints", () => {
		const config = createSdkConfig(resolveRoute("mina:mainnet", "zeko:zeko-mainnet"))

		expect(config.l1Url).toBe("https://gateway.mina.mainnet.zeko.io")
		expect(config.l1ArchiveUrl).toBe("https://gateway.mina.archive.mainnet.zeko.io")
		expect(config.zekoUrl).toBe("https://mainnet.zeko.io/graphql")
		expect(config.zekoArchiveUrl).toBe("https://archive.mainnet.zeko.io/graphql")
		expect(config.actionsApi).toBe("https://api.actions.zeko.io/graphql")
		expect(config.l1Network).toBe("mainnet")
		expect(config.l2Network).toEqual({ custom: "zeko-mainnet" })
		expect(config.verbose).toBe(false)
	})
})
