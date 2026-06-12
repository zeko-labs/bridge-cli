import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { defineCommand, type CommandDef } from "citty"
import { createRequire } from "node:module"
import { resolveAppPaths } from "../core/paths"
import { createSessionStore } from "../core/session-store"
import type { OperationSession } from "../core/types"

type TuiModule = typeof import("@opentui/core")

type TuiCommandArgs = {
	id: { type: "positional"; required: false }
}

export const renderTuiSnapshot = ({
	sessions,
	focus,
	logContent
}: {
	sessions: OperationSession[]
	focus: OperationSession | null
	logContent: string
}): string => {
	const activeSessions = sessions.filter((session) => session.status === "running")
	const completedSessions = sessions.filter((session) => session.status !== "running")
	const renderSessionLine = (session: OperationSession) =>
		[
			session.id === focus?.id ? ">" : " ",
			session.id,
			session.status,
			session.route,
			`amount=${session.amount}`,
			`updated=${session.updatedAt}`
		].join(" ")

	const lines = ["zeko-bridge tui", "", "Controls: q quit, Ctrl-C quit", "", "Active operations:"]

	lines.push(
		...(activeSessions.length > 0
			? activeSessions.map(renderSessionLine)
			: ["No active operations found."])
	)

	lines.push("", "Completed operations:")
	lines.push(
		...(completedSessions.length > 0
			? completedSessions.map(renderSessionLine)
			: ["No completed operations found."])
	)

	if (!focus) return lines.join("\n")

	lines.push(
		"",
		"Selected operation:",
		`ID: ${focus.id}`,
		`Status: ${focus.status}`,
		`Phase: ${focus.phase}`,
		`Route: ${focus.route}`,
		`Recipient: ${focus.recipient ?? focus.account}`,
		`Amount: ${focus.amount}`,
		`Log: ${focus.logPath}`,
		"",
		"Recent log lines:"
	)

	const tail = logContent.trim().split(/\r?\n/).filter(Boolean).slice(-12)

	lines.push(...(tail.length > 0 ? tail : ["No log entries yet."]))

	return lines.join("\n")
}

const readLogFile = async (logPath: string): Promise<string> => {
	try {
		return await readFile(logPath, "utf8")
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return ""
		}
		throw error
	}
}

const parseOptionalId = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined

const parseBunManifest = (value: unknown): { bin: { bun: string } } => {
	if (
		typeof value !== "object" ||
		value === null ||
		!("bin" in value) ||
		typeof value.bin !== "object" ||
		value.bin === null ||
		!("bun" in value.bin) ||
		typeof value.bin.bun !== "string"
	) {
		throw new Error("Unable to resolve bundled Bun binary from bun/package.json")
	}

	return { bin: { bun: value.bin.bun } }
}

const resolveBundledBunPath = (): string => {
	const require = createRequire(import.meta.url)
	const packageJsonPath = require.resolve("bun/package.json")
	const pkg = parseBunManifest(JSON.parse(readFileSync(packageJsonPath, "utf8")))
	return path.join(path.dirname(packageJsonPath), pkg.bin.bun)
}

const runBundledBunTui = async (id?: string): Promise<void> => {
	const bunPath = resolveBundledBunPath()
	const cliPath = process.argv[1]
	if (!cliPath) {
		throw new Error("Unable to determine the current CLI entrypoint for TUI respawn.")
	}

	await new Promise<void>((resolve, reject) => {
		const child = spawn(bunPath, [cliPath, "tui", ...(id ? [id] : [])], {
			stdio: "inherit",
			env: process.env
		})

		child.once("error", reject)
		child.once("exit", (code) => {
			if (code === 0) {
				resolve()
				return
			}

			reject(new Error(`Bundled Bun TUI exited with code ${code ?? "unknown"}`))
		})
	})
}

export const createTuiCommand = ({
	loadRenderer,
	spawnBundledTui = runBundledBunTui
}: {
	loadRenderer?: () => Promise<TuiModule>
	spawnBundledTui?: (id?: string) => Promise<void>
} = {}): CommandDef<TuiCommandArgs> =>
	defineCommand({
		meta: {
			name: "tui",
			description: "Open the bridge operation terminal UI."
		},
		args: {
			id: { type: "positional", required: false }
		},
		async run({ args }) {
			const targetId = parseOptionalId(args.id)
			if (!("bun" in process.versions)) {
				await spawnBundledTui(targetId)
				return
			}

			const appPaths = resolveAppPaths()
			const store = createSessionStore({ stateDir: appPaths.stateDir })

			const rendererModule = await (loadRenderer ?? (() => import("@opentui/core")))()
			const { BoxRenderable, TextRenderable, createCliRenderer } = rendererModule

			let resolveDone: (() => void) | undefined
			const done = new Promise<void>((resolve) => {
				resolveDone = resolve
			})

			const renderer = await createCliRenderer({
				exitOnCtrlC: true,
				useAlternateScreen: true,
				onDestroy: () => resolveDone?.()
			})
			const frame = new BoxRenderable(renderer, {
				width: "100%",
				height: "100%",
				padding: 1
			})
			const body = new TextRenderable(renderer, {
				width: "100%",
				height: "100%",
				content: "Loading bridge operations..."
			})

			frame.add(body)
			renderer.root.add(frame)

			const refresh = async () => {
				const sessions = await store.list()
				const focus =
					targetId !== undefined
						? sessions.find((session) => session.id === targetId) ?? null
						: sessions[0] ?? null

				if (targetId !== undefined && focus === null) {
					throw new Error(`Operation ${targetId} not found`)
				}

				const logContent = focus ? await readLogFile(focus.logPath) : ""
				body.content = renderTuiSnapshot({ sessions, focus, logContent })
			}

			await refresh()
			const interval = setInterval(() => {
				void refresh().catch((error: unknown) => {
					body.content = error instanceof Error ? error.message : String(error)
				})
			}, 2_000)

			const close = () => {
				clearInterval(interval)
				if (!renderer.isDestroyed) {
					renderer.destroy()
				}
			}

			renderer.addInputHandler((sequence) => {
				if (sequence === "q" || sequence === "Q" || sequence === "\u001b") {
					close()
					return true
				}

				return false
			})

			renderer.start()
			await done
			clearInterval(interval)
		}
	})
