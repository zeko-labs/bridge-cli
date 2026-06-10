import { mkdir, appendFile } from "node:fs/promises"
import path from "node:path"

type LogPayload = Record<string, unknown>

export const createOperationLogger = ({ logPath }: { logPath: string }) => ({
	async write(event: string, payload: LogPayload = {}): Promise<void> {
		await mkdir(path.dirname(logPath), { recursive: true })
		await appendFile(
			logPath,
			`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...payload })}\n`
		)
	}
})
