import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const LIVE_TIMEOUT_MS = 6 * 60 * 60 * 1_000

type LiveBridgeResult = {
	success: boolean
	operation_id: string
	route: string
	direction: string
	status: string
	amount: string
	recipient: string
	submitted_transactions: Array<{ action: string; hash: string }>
	final_transaction: { action: string; hash: string; explorerUrl?: string } | null
	explorer_urls: string[]
	log_path: string
}

const runLiveBridge = async ({
	from,
	to
}: {
	from: string
	to: string
}): Promise<LiveBridgeResult> => {
	try {
		const { stdout } = await execFileAsync(
			process.execPath,
			["./dist/cli.js", "bridge", "--from", from, "--to", to, "--amount", "1", "--json"],
			{
				cwd: new URL("..", import.meta.url),
				env: process.env,
				maxBuffer: 10 * 1024 * 1024
			}
		)

		return JSON.parse(stdout) as LiveBridgeResult
	} catch (error) {
		const message =
			error instanceof Error
				? `${error.message}\n${"stderr" in error ? String(error.stderr) : ""}`
				: String(error)
		throw new Error(`Live bridge command failed for ${from} -> ${to}\n${message}`)
	}
}

const assertSuccessfulBridge = ({
	result,
	route,
	direction
}: {
	result: LiveBridgeResult
	route: string
	direction: string
}) => {
	expect(result.success).toBe(true)
	expect(result.route).toBe(route)
	expect(result.direction).toBe(direction)
	expect(result.status).toBe("completed")
	expect(result.submitted_transactions.length).toBeGreaterThan(0)
	expect(result.final_transaction).not.toBeNull()
	expect(result.log_path.length).toBeGreaterThan(0)
}

describe.sequential("manual live bridge validation", () => {
	it(
		"validates mina:testnet -> zeko:testnet through the single bridge command",
		async () => {
			const result = await runLiveBridge({
				from: "mina:testnet",
				to: "zeko:testnet"
			})

			assertSuccessfulBridge({
				result,
				route: "mina:testnet->zeko:testnet",
				direction: "deposit"
			})
		},
		LIVE_TIMEOUT_MS
	)

	it(
		"validates zeko:testnet -> mina:testnet through the single bridge command",
		async () => {
			const result = await runLiveBridge({
				from: "zeko:testnet",
				to: "mina:testnet"
			})

			assertSuccessfulBridge({
				result,
				route: "zeko:testnet->mina:testnet",
				direction: "withdrawal"
			})
		},
		LIVE_TIMEOUT_MS
	)
})
