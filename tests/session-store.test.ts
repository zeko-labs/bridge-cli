import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { afterEach, describe, expect, it } from "vitest"
import { createSessionStore, type OperationSession } from "../src/core/session-store"

const tempDirs: string[] = []

afterEach(async () => {
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
	tempDirs.length = 0
})

describe("session store", () => {
	it("persists and lists operations", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "zeko-bridge-session-"))
		tempDirs.push(root)
		const store = createSessionStore({ stateDir: root })

		const session: OperationSession = {
			id: "op-1",
			status: "running",
			phase: "submitted",
			route: "mina:testnet->zeko:testnet",
			direction: "deposit",
			account: "B62test",
			amount: "1.5",
			logPath: "/tmp/op-1.log",
			createdAt: "2026-03-09T19:00:00.000Z",
			updatedAt: "2026-03-09T19:00:00.000Z",
			submittedTransactions: [{ action: "submit", hash: "hash-1" }]
		}

		await store.save(session)

		expect(await store.load("op-1")).toEqual(session)
		expect(await store.list()).toEqual([session])
	})
})
