import { describe, expect, it } from "vitest"
import { isRecoverableMutationError } from "../src/core/mutation-errors"

describe("mutation error classification", () => {
	it("treats transient gateway failures as recoverable", () => {
		expect(isRecoverableMutationError(new Error("[Network] Bad Gateway"))).toBe(true)
		expect(isRecoverableMutationError(new Error("[Network] 502 Bad Gateway"))).toBe(true)
	})

	it("does not treat semantic transaction failures as recoverable", () => {
		expect(isRecoverableMutationError(new Error("Invalid account update"))).toBe(false)
	})
})
