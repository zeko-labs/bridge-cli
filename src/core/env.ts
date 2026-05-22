import { constants } from "node:fs"
import { access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadDotenvConfig } from "dotenv"

type EnvLike = Record<string, string | undefined>
type LoadedEnv = Record<string, string>

export const resolveBridgeCliDotenvPaths = ({
	homeDir = os.homedir(),
	cliModuleUrl = import.meta.url,
	argv = process.argv,
	cwd = process.cwd()
}: {
	homeDir?: string
	cliModuleUrl?: string
	argv?: string[]
	cwd?: string
} = {}): string[] => {
	const candidates = [path.join(homeDir, ".zeko", ".env")]
	const cliBinaryPath = fileURLToPath(cliModuleUrl)
	candidates.push(path.join(path.dirname(cliBinaryPath), ".env"))

	const invocationPath = argv[1]
	if (typeof invocationPath === "string" && invocationPath.length > 0) {
		const resolvedInvocationPath = path.isAbsolute(invocationPath)
			? invocationPath
			: path.resolve(cwd, invocationPath)
		candidates.push(path.join(path.dirname(resolvedInvocationPath), ".env"))
	}

	return [...new Set(candidates)]
}

const canReadFile = async (filePath: string): Promise<boolean> => {
	try {
		await access(filePath, constants.R_OK)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false
		}

		if ((error as NodeJS.ErrnoException).code === "EACCES") {
			return false
		}

		throw error
	}
}

export const loadBridgeCliEnv = async ({
	env = process.env,
	paths = resolveBridgeCliDotenvPaths(),
	canRead = canReadFile,
	loadConfig = (filePath, processEnv) =>
		loadDotenvConfig({
			path: filePath,
			processEnv,
			override: false,
			quiet: true
		})
}: {
	env?: EnvLike
	paths?: string[]
	canRead?: (filePath: string) => Promise<boolean>
	loadConfig?: (
		filePath: string,
		processEnv: LoadedEnv
	) => {
		parsed?: Record<string, string>
		error?: Error
	}
} = {}): Promise<{ loadedPaths: string[] }> => {
	const loadedValues: LoadedEnv = Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
	)
	const loadedPaths: string[] = []

	for (const filePath of paths) {
		if (!(await canRead(filePath))) {
			continue
		}

		const result = loadConfig(filePath, loadedValues)

		if (result.error) {
			throw result.error
		}

		loadedPaths.push(filePath)
	}

	Object.assign(env, loadedValues)

	return { loadedPaths }
}
