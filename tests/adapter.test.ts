import { describe, expect, it } from "vitest"
import { MAX_FEE_RETRIES, normalizeStatusTimestamp, sendWithFeeRetries } from "../src/core/adapter"

describe("adapter fee retries", () => {
	it("accepts SDK operations that already executed and returned a hash", async () => {
		const result = await sendWithFeeRetries({
			initialFeeNanomina: 100n,
			createTransaction: async () => ({ hash: "5Jexecuted" }),
			sendTransaction: async (transaction) => transaction
		})

		expect(result).toEqual({ hash: "5Jexecuted" })
	})

	it("doubles the fee on low-fee send failures until the transaction succeeds", async () => {
		const seenFees: bigint[] = []
		let attempts = 0

		const result = await sendWithFeeRetries({
			initialFeeNanomina: 100n,
			createTransaction: async (feeNanomina) => {
				seenFees.push(feeNanomina)
				return `transaction:${feeNanomina}`
			},
			sendTransaction: async () => {
				attempts += 1
				if (attempts < 3) {
					throw new Error('Transaction failed: "Fee is too low"')
				}

				return { hash: "ok" }
			}
		})

		expect(result).toEqual({ hash: "ok" })
		expect(seenFees).toEqual([100n, 200n, 400n])
	})

	it("does not retry errors that are unrelated to low fees", async () => {
		const seenFees: bigint[] = []

		await expect(
			sendWithFeeRetries({
				initialFeeNanomina: 100n,
				createTransaction: async (feeNanomina) => {
					seenFees.push(feeNanomina)
					return `transaction:${feeNanomina}`
				},
				sendTransaction: async () => {
					throw new Error("network unavailable")
				}
			})
		).rejects.toThrow("network unavailable")

		expect(seenFees).toEqual([100n])
	})

	it("gives up after the same retry budget as the ui transaction machine", async () => {
		const seenFees: bigint[] = []

		await expect(
			sendWithFeeRetries({
				initialFeeNanomina: 100n,
				createTransaction: async (feeNanomina) => {
					seenFees.push(feeNanomina)
					return `transaction:${feeNanomina}`
				},
				sendTransaction: async () => {
					throw new Error('Transaction failed: "Fee is too low"')
				}
			})
		).rejects.toThrow("Fee is too low")

		expect(seenFees).toHaveLength(MAX_FEE_RETRIES + 1)
		expect(seenFees).toEqual([100n, 200n, 400n, 800n, 1600n, 3200n])
	})

	it("normalizes unknown status timestamps instead of exposing zero-like sentinels", () => {
		expect(normalizeStatusTimestamp("0")).toBe("")
		expect(normalizeStatusTimestamp("2026-03-25T00:00:00.000Z")).toBe("2026-03-25T00:00:00.000Z")
	})
})
