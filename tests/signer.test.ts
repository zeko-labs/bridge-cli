import { describe, expect, it } from "vitest"
import { PrivateKey } from "o1js"
import {
	assertSignerMatchesAccount,
	resolveSignerKeys,
	toSignerPublicKey
} from "../src/core/signer"

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

	it("derives the signer public key without exposing the private key", () => {
		const key = PrivateKey.random()

		expect(toSignerPublicKey(key.toBase58())).toBe(key.toPublicKey().toBase58())
	})

	it("rejects explicit accounts that do not match the signer", () => {
		const signer = PrivateKey.random()
		const otherAccount = PrivateKey.random().toPublicKey().toBase58()

		expect(() =>
			assertSignerMatchesAccount({
				account: otherAccount,
				privateKey: signer.toBase58(),
				network: "mina:testnet"
			})
		).toThrow(
			`Signer public key ${signer.toPublicKey().toBase58()} does not match --account ${otherAccount} for mina:testnet`
		)
	})
})
