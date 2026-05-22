import { describe, expect, it } from "vitest"
import { minaStringToNanomina } from "../src/core/format"

describe("amount formatting", () => {
	it("converts decimal MINA strings to exact nanomina", () => {
		expect(minaStringToNanomina("1")).toBe(1_000_000_000n)
		expect(minaStringToNanomina("0.3")).toBe(300_000_000n)
		expect(minaStringToNanomina("0.000000001")).toBe(1n)
	})

	it("rejects values with more than 9 decimal places", () => {
		expect(() => minaStringToNanomina("0.0000000001")).toThrowError("Invalid MINA amount")
	})
})
