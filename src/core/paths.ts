import os from "node:os"
import path from "node:path"

type EnvLike = Partial<Record<string, string | undefined>>

export type AppPaths = {
	dataDir: string
	stateDir: string
	logDir: string
	cacheDir: string
}

export const APP_DIR_NAME = "zeko-bridge"

const resolveHome = (env: EnvLike) => env.HOME ?? os.homedir()

export const resolveAppPaths = ({
	env = process.env,
	platform = process.platform
}: {
	env?: EnvLike
	platform?: NodeJS.Platform
} = {}): AppPaths => {
	if (platform === "darwin") {
		const home = resolveHome(env)
		const supportRoot = path.join(home, "Library", "Application Support")
		const logsRoot = path.join(home, "Library", "Logs")
		const cacheRoot = path.join(home, "Library", "Caches")

		return {
			dataDir: path.join(supportRoot, APP_DIR_NAME),
			stateDir: path.join(supportRoot, APP_DIR_NAME, "state"),
			logDir: path.join(logsRoot, APP_DIR_NAME),
			cacheDir: path.join(cacheRoot, APP_DIR_NAME)
		}
	}

	if (platform === "win32") {
		const appData = env.APPDATA ?? path.join(resolveHome(env), "AppData", "Roaming")
		const localAppData = env.LOCALAPPDATA ?? path.join(resolveHome(env), "AppData", "Local")

		return {
			dataDir: path.join(appData, APP_DIR_NAME),
			stateDir: path.join(localAppData, APP_DIR_NAME, "state"),
			logDir: path.join(localAppData, APP_DIR_NAME, "logs"),
			cacheDir: path.join(localAppData, APP_DIR_NAME, "cache")
		}
	}

	const home = resolveHome(env)
	const dataRoot = env.XDG_DATA_HOME ?? path.join(home, ".local", "share")
	const stateRoot = env.XDG_STATE_HOME ?? path.join(home, ".local", "state")
	const cacheRoot = env.XDG_CACHE_HOME ?? path.join(home, ".cache")

	return {
		dataDir: path.join(dataRoot, APP_DIR_NAME),
		stateDir: path.join(stateRoot, APP_DIR_NAME),
		logDir: path.join(stateRoot, APP_DIR_NAME, "logs"),
		cacheDir: path.join(cacheRoot, APP_DIR_NAME)
	}
}
