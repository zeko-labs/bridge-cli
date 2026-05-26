import { defineCommand, type CommandDef } from "citty"
import { resolveAppPaths } from "../core/paths"
import { resolveSignerKeys, toSignerPublicKey } from "../core/signer"
import { KNOWN_ROUTES } from "../core/routes"

type DoctorCommandDeps = {
	resolvePaths?: typeof resolveAppPaths
	resolveKeys?: typeof resolveSignerKeys
	write?: (message: string) => void
}

export const createDoctorCommand = (deps: DoctorCommandDeps = {}): CommandDef =>
	defineCommand({
		meta: {
			name: "doctor",
			description: "Check CLI prerequisites and environment configuration."
		},
		async run() {
			const paths = (deps.resolvePaths ?? resolveAppPaths)()
			const keyConfig = (() => {
				try {
					const keys = (deps.resolveKeys ?? resolveSignerKeys)()
					return { ok: true, publicKey: toSignerPublicKey(keys.mina) }
				} catch (error) {
					return { ok: false, message: error instanceof Error ? error.message : String(error) }
				}
			})()
			;(deps.write ?? console.log)(
				[
					"bridge doctor",
					`Data dir: ${paths.dataDir}`,
					`State dir: ${paths.stateDir}`,
					`Log dir: ${paths.logDir}`,
					`Wallet private key: ${keyConfig.ok ? "configured" : keyConfig.message}`,
					...(keyConfig.ok ? [`Signer public key: ${keyConfig.publicKey}`] : []),
					`Known routes: ${KNOWN_ROUTES.map((route) => `${route.from}->${route.to}`).join(", ")}`
				].join("\n")
			)
		}
	})
