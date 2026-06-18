import { describe, expect, it } from "vitest"
import { createInstrumentedBridgeAdapter } from "../src/core/bridge-runtime/instrumentation"
import type { BridgeAdapter } from "../src/core/adapter"
import type { OperationSession } from "../src/core/types"

const session = {
	id: "op-instrumentation",
	status: "running",
	phase: "submitted",
	route: "mina:testnet->zeko-m:testnet",
	direction: "deposit",
	account: "B62account",
	recipient: "B62recipient",
	amount: "2",
	logPath: "/tmp/op-instrumentation.jsonl",
	createdAt: "2026-03-10T00:00:00.000Z",
	updatedAt: "2026-03-10T00:00:00.000Z",
	submittedTransactions: [],
	verboseDiagnostics: {
		sdkCalls: [],
		sdkMethodStats: {},
		phaseTimings: [{ phase: "submitted", startedAt: "2026-03-10T00:00:00.000Z", durationMs: 0 }],
		waitReasons: {}
	}
} satisfies OperationSession

describe("bridge runtime adapter instrumentation", () => {
	it("records SDK calls through one wrapper path", async () => {
		const adapter: Partial<BridgeAdapter> = {
			async canFinalizeDeposit() {
				return { available: true, reason: null, index: 0 }
			}
		}
		const instrumented = createInstrumentedBridgeAdapter({
			adapter,
			session,
			now: (() => {
				const dates = ["2026-03-10T00:00:01.000Z", "2026-03-10T00:00:01.250Z"]
				return () => dates.shift() ?? "2026-03-10T00:00:01.250Z"
			})()
		})

		const result = await instrumented.call("canFinalizeDeposit", () =>
			adapter.canFinalizeDeposit?.("B62account")
		)

		expect(result.value).toEqual({ available: true, reason: null, index: 0 })
		expect(result.session.verboseDiagnostics?.sdkMethodStats.canFinalizeDeposit).toMatchObject({
			count: 1,
			successCount: 1,
			errorCount: 0,
			totalDurationMs: 250,
			lastResult: "available=true"
		})
	})

	it("preserves capability wait reasons on verbose sessions", () => {
		const instrumented = createInstrumentedBridgeAdapter({
			adapter: {},
			session,
			now: () => "2026-03-10T00:00:01.000Z"
		})

		const next = instrumented.recordWaitReason("canFinalizeDeposit", {
			available: false,
			reason: "not ready"
		})

		expect(next.verboseDiagnostics?.waitReasons?.canFinalizeDeposit).toEqual({
			available: false,
			reason: "not ready"
		})
	})

	it("leaves non-verbose sessions unchanged", async () => {
		const quietSession = { ...session, verboseDiagnostics: undefined }
		const instrumented = createInstrumentedBridgeAdapter({
			adapter: {},
			session: quietSession,
			now: () => "2026-03-10T00:00:01.000Z"
		})

		const result = await instrumented.call("getDepositStatuses", async () => [])

		expect(result.session).toBe(quietSession)
	})
})
