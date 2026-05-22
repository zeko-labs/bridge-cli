import { describe, expect, it } from "vitest"
import { resolveSignerKeys } from "../src/core/signer"

describe("signer keys", () => {
	it("uses the shared wallet private key for Mina and Zeko", () => {
		const keys = resolveSignerKeys({
			MINA_PRIVATE_KEY: "wallet-secret"
		})

		expect(keys.mina).toBe("wallet-secret")
		expect(keys.zeko).toBe("wallet-secret")
		expect(keys.eth).toBeUndefined()
	})

	it("throws a redacted error when the shared wallet key is missing", () => {
		expect(() => resolveSignerKeys({})).toThrowError(
			"Missing required signer private key: MINA_PRIVATE_KEY"
		)
	})
})
