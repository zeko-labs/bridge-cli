import type { BridgeAdapter } from "../adapter"
import type {
	BridgeCapabilityDiagnostic,
	BridgeSdkCallTrace,
	BridgeSdkMethodStat,
	BridgeSdkOperation,
	OperationPhase,
	OperationSession
} from "../types"

type InstrumentedBridgeAdapterInput = {
	adapter: Partial<BridgeAdapter>
	session: OperationSession
	now?: () => string
}

const formatErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

const summarizeSdkResult = (value: unknown): string | undefined => {
	if (typeof value === "boolean") return String(value)

	if (Array.isArray(value)) return `count=${value.length}`

	if (typeof value === "object" && value !== null) {
		if ("available" in value && typeof value.available === "boolean") {
			const reason =
				"reason" in value && typeof value.reason === "string" ? ` reason=${value.reason}` : ""
			return `available=${String(value.available)}${reason}`
		}

		if ("hash" in value && typeof value.hash === "string") {
			return `hash=${value.hash}`
		}
	}

	return undefined
}

const buildSdkMethodStats = (
	calls: BridgeSdkCallTrace[]
): Partial<Record<BridgeSdkOperation, BridgeSdkMethodStat>> => {
	const stats: Partial<Record<BridgeSdkOperation, BridgeSdkMethodStat>> = {}

	for (const trace of calls) {
		const previous = stats[trace.operation]
		stats[trace.operation] = {
			count: (previous?.count ?? 0) + 1,
			successCount: (previous?.successCount ?? 0) + (trace.success ? 1 : 0),
			errorCount: (previous?.errorCount ?? 0) + (trace.success ? 0 : 1),
			totalDurationMs: (previous?.totalDurationMs ?? 0) + trace.durationMs,
			lastStartedAt: trace.startedAt,
			lastEndedAt: trace.endedAt,
			lastDurationMs: trace.durationMs,
			lastMessage: trace.message,
			lastResult: trace.result
		}
	}

	return stats
}

export const createVerboseDiagnostics = (
	startedAt: string,
	phase: OperationPhase
): NonNullable<OperationSession["verboseDiagnostics"]> => ({
	sdkCalls: [],
	sdkMethodStats: {},
	phaseTimings: [{ phase, startedAt, durationMs: 0 }],
	waitReasons: {}
})

export const withPhaseTiming = ({
	diagnostics,
	now,
	nextPhase
}: {
	diagnostics: NonNullable<OperationSession["verboseDiagnostics"]>
	now: string
	nextPhase: OperationPhase
}): NonNullable<OperationSession["verboseDiagnostics"]> => {
	const phaseTimings = [...diagnostics.phaseTimings]
	const current = phaseTimings.at(-1)

	if (!current) {
		return {
			...diagnostics,
			phaseTimings: [{ phase: nextPhase, startedAt: now, durationMs: 0 }]
		}
	}

	const elapsed = Math.max(0, Date.parse(now) - Date.parse(current.startedAt))
	const currentWithElapsed = {
		...current,
		endedAt: now,
		durationMs: Number.isNaN(elapsed) ? current.durationMs : elapsed
	}

	if (current.phase === nextPhase) {
		phaseTimings[phaseTimings.length - 1] = {
			...currentWithElapsed,
			endedAt: undefined
		}
		return { ...diagnostics, phaseTimings }
	}

	phaseTimings[phaseTimings.length - 1] = currentWithElapsed
	phaseTimings.push({ phase: nextPhase, startedAt: now, durationMs: 0 })
	return { ...diagnostics, phaseTimings }
}

export const withRecordedSdkCall = ({
	session,
	trace
}: {
	session: OperationSession
	trace: BridgeSdkCallTrace
}): OperationSession => {
	if (!session.verboseDiagnostics) return session

	const sdkCalls = [...session.verboseDiagnostics.sdkCalls, trace]
	return {
		...session,
		verboseDiagnostics: {
			...session.verboseDiagnostics,
			sdkCalls,
			sdkMethodStats: buildSdkMethodStats(sdkCalls)
		}
	}
}

export const withCapabilityWaitReason = ({
	session,
	key,
	diagnostic
}: {
	session: OperationSession
	key: "canFinalizeDeposit" | "canCancelDeposit" | "canFinalizeWithdrawal"
	diagnostic: BridgeCapabilityDiagnostic
}): OperationSession => {
	if (!session.verboseDiagnostics) return session

	return {
		...session,
		verboseDiagnostics: {
			...session.verboseDiagnostics,
			waitReasons: {
				...session.verboseDiagnostics.waitReasons,
				[key]: diagnostic
			}
		}
	}
}

export const mergeVerboseDiagnosticsFromSessions = ({
	session,
	sources
}: {
	session: OperationSession
	sources: OperationSession[]
}): OperationSession => {
	if (!session.verboseDiagnostics) return sources.at(-1) ?? session

	const baseCallCount = session.verboseDiagnostics.sdkCalls.length
	const sdkCalls = [...session.verboseDiagnostics.sdkCalls]
	const waitReasons = { ...(session.verboseDiagnostics.waitReasons ?? {}) }

	for (const source of sources) {
		if (!source.verboseDiagnostics) continue
		sdkCalls.push(...source.verboseDiagnostics.sdkCalls.slice(baseCallCount))
		Object.assign(waitReasons, source.verboseDiagnostics.waitReasons ?? {})
	}

	return {
		...session,
		verboseDiagnostics: {
			...session.verboseDiagnostics,
			sdkCalls,
			sdkMethodStats: buildSdkMethodStats(sdkCalls),
			waitReasons
		}
	}
}

export const createInstrumentedBridgeAdapter = ({
	adapter,
	session,
	now = () => new Date().toISOString()
}: InstrumentedBridgeAdapterInput) => ({
	adapter,
	async call<T>(
		operation: BridgeSdkOperation,
		run: () => Promise<T> | T,
		options: { attempt?: number } = {}
	): Promise<{ session: OperationSession; value: T }> {
		const attempt = options.attempt ?? 1
		const startedAt = now()
		const startedAtMs = Date.parse(startedAt)
		try {
			const value = await run()
			const endedAt = now()
			const endedAtMs = Date.parse(endedAt)
			return {
				value,
				session: withRecordedSdkCall({
					session,
					trace: {
						operation,
						attempt,
						startedAt,
						endedAt,
						durationMs:
							Number.isNaN(startedAtMs) || Number.isNaN(endedAtMs)
								? 0
								: Math.max(0, endedAtMs - startedAtMs),
						success: true,
						result: summarizeSdkResult(value)
					}
				})
			}
		} catch (error) {
			const endedAt = now()
			const endedAtMs = Date.parse(endedAt)
			const nextSession = withRecordedSdkCall({
				session,
				trace: {
					operation,
					attempt,
					startedAt,
					endedAt,
					durationMs:
						Number.isNaN(startedAtMs) || Number.isNaN(endedAtMs)
							? 0
							: Math.max(0, endedAtMs - startedAtMs),
					success: false,
					message: formatErrorMessage(error)
				}
			})
			if (error instanceof Error) {
				Object.assign(error, { session: nextSession })
				throw error
			}

			const nextError = new Error(formatErrorMessage(error))
			Object.assign(nextError, { session: nextSession })
			throw nextError
		}
	},
	recordWaitReason(
		key: "canFinalizeDeposit" | "canCancelDeposit" | "canFinalizeWithdrawal",
		diagnostic: BridgeCapabilityDiagnostic
	): OperationSession {
		return withCapabilityWaitReason({ session, key, diagnostic })
	}
})
