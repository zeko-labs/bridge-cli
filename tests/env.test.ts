import { describe, expect, it } from "vitest"
import { loadBridgeCliEnv, resolveBridgeCliDotenvPaths } from "../src/core/env"

describe("bridge cli env loading", () => {
	it("resolves dotenv candidates in the requested precedence order", () => {
		expect(
			resolveBridgeCliDotenvPaths({
				homeDir: "/home/tester",
				cliModuleUrl: "file:///workspace/packages/bridge-cli/dist/cli.js",
				argv: ["/usr/bin/node", "./bin/zeko-bridge"],
				cwd: "/workspace/project"
			})
		).toEqual([
			"/home/tester/.zeko/.env",
			"/workspace/packages/bridge-cli/dist/.env",
			"/workspace/project/bin/.env"
		])
	})

	it("keeps inherited env values above every dotenv file location", async () => {
		const env: Record<string, string | undefined> = {
			MINA_PRIVATE_KEY: "inline-wallet"
		}
		const parsedByPath: Record<string, Record<string, string>> = {
			"/home/tester/.zeko/.env": { MINA_PRIVATE_KEY: "home-wallet" },
			"/workspace/packages/bridge-cli/dist/.env": { MINA_PRIVATE_KEY: "binary-wallet" },
			"/workspace/project/bin/.env": { MINA_PRIVATE_KEY: "invocation-wallet" }
		}

		const result = await loadBridgeCliEnv({
			env,
			paths: Object.keys(parsedByPath),
			canRead: async () => true,
			loadConfig: (filePath, processEnv) => {
				for (const [key, value] of Object.entries(parsedByPath[filePath] ?? {})) {
					if (processEnv[key] === undefined) {
						processEnv[key] = value
					}
				}

				return { parsed: parsedByPath[filePath] ?? {} }
			}
		})

		expect(result.loadedPaths).toEqual([
			"/home/tester/.zeko/.env",
			"/workspace/packages/bridge-cli/dist/.env",
			"/workspace/project/bin/.env"
		])
		expect(env.MINA_PRIVATE_KEY).toBe("inline-wallet")
	})

	it("uses the first readable dotenv value only when the key is not inherited", async () => {
		const env: Record<string, string | undefined> = {}
		const parsedByPath: Record<string, Record<string, string>> = {
			"/home/tester/.zeko/.env": { MINA_PRIVATE_KEY: "home-wallet" },
			"/workspace/packages/bridge-cli/dist/.env": { MINA_PRIVATE_KEY: "binary-wallet" },
			"/workspace/project/bin/.env": { MINA_PRIVATE_KEY: "invocation-wallet" }
		}

		await loadBridgeCliEnv({
			env,
			paths: Object.keys(parsedByPath),
			canRead: async () => true,
			loadConfig: (filePath, processEnv) => {
				for (const [key, value] of Object.entries(parsedByPath[filePath] ?? {})) {
					if (processEnv[key] === undefined) {
						processEnv[key] = value
					}
				}

				return { parsed: parsedByPath[filePath] ?? {} }
			}
		})

		expect(env.MINA_PRIVATE_KEY).toBe("home-wallet")
	})

	it("skips unreadable dotenv candidates and falls back to inherited env", async () => {
		const env: Record<string, string | undefined> = {
			MINA_PRIVATE_KEY: "global-wallet"
		}

		await loadBridgeCliEnv({
			env,
			paths: ["/blocked/.env", "/missing/.env"],
			canRead: async () => false
		})

		expect(env.MINA_PRIVATE_KEY).toBe("global-wallet")
	})
})
