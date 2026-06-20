import { describe, expect, it } from "vitest"
import { resolveRoute } from "../src/core/routes"
import { createSdkConfig } from "../src/core/sdk-config"

describe("sdk config", () => {
	it("maps the supported testnet route to bridge-sdk endpoints", () => {
		const config = createSdkConfig(resolveRoute("mina:testnet", "zeko-m:testnet"))

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
		const config = createSdkConfig(resolveRoute("mina:testnet", "zeko-m:testnet"), {
			verbose: true
		})

		expect(config.verbose).toBe(true)
	})

	it("can override the actions api endpoint for local validation", () => {
		const config = createSdkConfig(resolveRoute("mina:testnet", "zeko-m:testnet"), {
			actionsApi: "http://127.0.0.1:9100/graphql"
		})

		expect(config.actionsApi).toBe("http://127.0.0.1:9100/graphql")
		expect(config.l1Url).toBe("https://gateway.mina.devnet.zeko.io")
		expect(config.zekoUrl).toBe("https://testnet.zeko.io/graphql")
	})

	it("can override Mina live and archive endpoints for local validation", () => {
		const config = createSdkConfig(resolveRoute("zeko-m:testnet", "mina:testnet"), {
			l1Url: "https://mina.devnet.zeko.io/graphql",
			l1ArchiveUrl: "https://archive.example.test/graphql"
		})

		expect(config.l1Url).toBe("https://mina.devnet.zeko.io/graphql")
		expect(config.l1ArchiveUrl).toBe("https://archive.example.test/graphql")
		expect(config.actionsApi).toBe("https://testnet.api.actions.zeko.io/graphql")
		expect(config.zekoUrl).toBe("https://testnet.zeko.io/graphql")
	})

	it("maps the supported mainnet route to bridge-sdk endpoints", () => {
		const config = createSdkConfig(resolveRoute("mina:mainnet", "zeko-m:mainnet"))

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
