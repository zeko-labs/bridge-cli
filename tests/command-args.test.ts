import { describe, expect, it } from "vitest"
import {
	readAliasedNumberArg,
	readAliasedOptionalNumberArg,
	readBooleanArg,
	readOptionalStringArg
} from "../src/core/command-args"

describe("command arg helpers", () => {
	it("reads optional strings without turning blanks into values", () => {
		expect(readOptionalStringArg({ account: "B62test" }, "account")).toBe("B62test")
		expect(readOptionalStringArg({ account: "" }, "account")).toBeUndefined()
		expect(readOptionalStringArg({ account: false }, "account")).toBeUndefined()
	})

	it("prefers camel-case values over kebab-case aliases for numeric flags", () => {
		expect(
			readAliasedNumberArg(
				{ pollIntervalMs: "120000", "poll-interval-ms": "180000" },
				"pollIntervalMs",
				"poll-interval-ms",
				"--poll-interval-ms"
			)
		).toBe(120_000)
	})

	it("falls back to kebab-case aliases for numeric flags", () => {
		expect(
			readAliasedNumberArg(
				{ pollIntervalMs: "", "poll-interval-ms": "180000" },
				"pollIntervalMs",
				"poll-interval-ms",
				"--poll-interval-ms"
			)
		).toBe(180_000)
	})

	it("rejects invalid non-negative numeric flags", () => {
		expect(() =>
			readAliasedNumberArg(
				{ retryDelayMs: "-1" },
				"retryDelayMs",
				"retry-delay-ms",
				"--retry-delay-ms"
			)
		).toThrow("--retry-delay-ms must be a non-negative number")
	})

	it("ignores non-finite optional numeric flags", () => {
		expect(
			readAliasedOptionalNumberArg(
				{ timeoutSlots: "not-a-number" },
				"timeoutSlots",
				"timeout-slots"
			)
		).toBeUndefined()
	})

	it("normalizes boolean flags", () => {
		expect(readBooleanArg({ json: true }, "json")).toBe(true)
		expect(readBooleanArg({ json: false }, "json")).toBe(false)
		expect(readBooleanArg({ json: "true" }, "json")).toBe(false)
	})
})
