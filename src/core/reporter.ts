import type {
	BridgeSdkMethodStat,
	BridgeSdkOperation,
	BridgeVerboseDiagnostics,
	OperationPhase,
	OperationSession,
	OperationStatus
} from "./types"
import { color, icon, keyValue, section } from "./terminal"

export type BridgeCommandJsonResult = {
	success: boolean
	operation_id: string
	route: OperationSession["route"]
	direction: OperationSession["direction"]
	status: OperationStatus
	amount: string
	recipient: string
	submitted_transactions: OperationSession["submittedTransactions"]
	final_transaction: OperationSession["finalTransaction"] | null
	explorer_urls: string[]
	log_path: string
	error: string | null
	verbose_diagnostics?: BridgeVerboseDiagnostics
}

export const toBridgeJsonResult = (session: OperationSession): BridgeCommandJsonResult => ({
	success: session.status === "completed",
	operation_id: session.id,
	route: session.route,
	direction: session.direction,
	status: session.status,
	amount: session.amount,
	recipient: session.recipient ?? session.account,
	submitted_transactions: session.submittedTransactions,
	final_transaction: session.finalTransaction ?? null,
	explorer_urls: session.finalTransaction?.explorerUrl
		? [session.finalTransaction.explorerUrl]
		: [],
	log_path: session.logPath,
	error: session.lastError ?? null,
	...(session.verboseDiagnostics ? { verbose_diagnostics: session.verboseDiagnostics } : {})
})

const formatDurationMs = (value: number): string => `${(value / 1_000).toFixed(3)}s`

const renderSdkMethodStats = (
	stats: NonNullable<BridgeVerboseDiagnostics["sdkMethodStats"]>
): string[] =>
	(Object.entries(stats) as Array<[BridgeSdkOperation, BridgeSdkMethodStat]>)
		.filter(([, value]) => value !== undefined)
		.map(([operation, value]) => {
			const suffix = [
				`count=${value.count}`,
				`ok=${value.successCount}`,
				`err=${value.errorCount}`,
				`total=${formatDurationMs(value.totalDurationMs)}`,
				value.lastDurationMs !== undefined ? `last=${formatDurationMs(value.lastDurationMs)}` : "",
				value.lastResult ? `result=${value.lastResult}` : "",
				value.lastMessage ? `message=${value.lastMessage}` : ""
			]
				.filter(Boolean)
				.join(" | ")
			return `${operation}: ${suffix}`
		})

const renderPhaseTimings = (diagnostics: BridgeVerboseDiagnostics): string[] =>
	diagnostics.phaseTimings.map(
		(phaseTiming) =>
			`${phaseTiming.phase}: started=${phaseTiming.startedAt} | duration=${formatDurationMs(phaseTiming.durationMs)}`
	)

const renderWaitReasons = (diagnostics: BridgeVerboseDiagnostics): string[] =>
	Object.entries(diagnostics.waitReasons ?? {})
		.filter(([, value]) => value !== undefined)
		.map(
			([operation, value]) =>
				`${operation}: available=${String(value?.available)} | reason=${value?.reason ?? "n/a"}`
		)

export const renderBridgeResult = (session: OperationSession): string =>
	[
		`${session.status === "completed" ? icon.success() : icon.error()} ${section(
			`Bridge ${session.status}`
		)}`,
		keyValue("Operation", session.id),
		keyValue("Route", session.route),
		keyValue("Phase", session.phase),
		keyValue("Recipient", session.recipient ?? session.account),
		keyValue("Amount", session.amount),
		session.queueAdvances && session.queueAdvances > 0
			? keyValue("Queued operations claimed", String(session.queueAdvances))
			: "",
		session.lastError ? keyValue("Error", session.lastError) : "",
		session.verboseDiagnostics ? section("Verbose Diagnostics") : "",
		session.verboseDiagnostics
			? [...renderSdkMethodStats(session.verboseDiagnostics.sdkMethodStats)].join("\n")
			: "",
		session.verboseDiagnostics
			? [...renderPhaseTimings(session.verboseDiagnostics)].join("\n")
			: "",
		session.verboseDiagnostics && renderWaitReasons(session.verboseDiagnostics).length > 0
			? renderWaitReasons(session.verboseDiagnostics).join("\n")
			: "",
		keyValue("Log", session.logPath),
		session.finalTransaction ? keyValue("Final hash", session.finalTransaction.hash) : ""
	]
		.filter(Boolean)
		.join("\n")

export const renderOperationProgress = ({
	event,
	phase,
	details
}: {
	event: string
	phase: OperationPhase
	details?: Record<string, unknown>
}): string => {
	const suffix = Object.entries(details ?? {})
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(([key, value]) => `${color.gray(`${key}=`)}${String(value)}`)
		.join(` ${icon.bullet()} `)

	const eventIcon =
		event === "failed"
			? icon.error()
			: event === "completed" || event === "finalized" || event === "submitted"
				? icon.success()
				: event === "heartbeat" || event.startsWith("waiting-")
					? icon.waiting()
					: icon.info()

	return [
		color.dim(`[${new Date().toISOString()}]`),
		eventIcon,
		color.bold(event),
		color.gray(`phase=${phase}`),
		suffix
	]
		.filter(Boolean)
		.join(" ")
}
