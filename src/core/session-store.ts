import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { OperationSession } from "./types"

export type SessionStore = ReturnType<typeof createSessionStore>
export type { OperationSession }

export const createSessionStore = ({ stateDir }: { stateDir: string }) => {
	const operationsDir = path.join(stateDir, "operations")

	const ensureDir = async () => {
		await mkdir(operationsDir, { recursive: true })
	}

	const filePath = (id: string) => path.join(operationsDir, `${id}.json`)

	return {
		async save(session: OperationSession): Promise<void> {
			await ensureDir()
			await writeFile(filePath(session.id), JSON.stringify(session, null, 2))
		},
		async load(id: string): Promise<OperationSession | null> {
			try {
				return JSON.parse(await readFile(filePath(id), "utf8")) as OperationSession
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") {
					return null
				}
				throw error
			}
		},
		async list(): Promise<OperationSession[]> {
			await ensureDir()
			const files = (await readdir(operationsDir)).filter((file) => file.endsWith(".json"))
			const sessions = await Promise.all(
				files.map(
					async (file) =>
						JSON.parse(await readFile(path.join(operationsDir, file), "utf8")) as OperationSession
				)
			)
			return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		}
	}
}
