import { defineCommand, type CommandDef } from "citty"
import { resolveAppPaths } from "../core/paths"
import { resolveSignerKeys, toSignerPublicKey } from "../core/signer"
import { KNOWN_ROUTES } from "../core/routes"
import { createSdkConfig } from "../core/sdk-config"

type DoctorCommandDeps = {
	resolvePaths?: typeof resolveAppPaths
	resolveKeys?: typeof resolveSignerKeys
	fetch?: typeof fetch
	write?: (message: string) => void
}

const healthUrlFromGraphqlUrl = (graphqlUrl: string): string => {
	const url = new URL(graphqlUrl)
	url.pathname = "/health"
	url.search = ""
	url.hash = ""
	return url.toString()
}

const checkBackendHealth = async ({
	fetchImpl,
	url
}: {
	fetchImpl: typeof fetch
	url: string
}): Promise<string> => {
	try {
		const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) })
		return `${response.status} ${response.statusText}`.trim()
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
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
			const enabledRoutes = KNOWN_ROUTES.filter((route) => route.enabled)
			const routeStatusLines = KNOWN_ROUTES.map((route) =>
				[
					`- ${route.from}->${route.to}`,
					route.enabled ? "enabled" : `disabled (${route.reason ?? "not enabled"})`
				].join(": ")
			)
			const endpointLines = enabledRoutes.map((route) => {
				const config = createSdkConfig(route)
				return `- ${route.from}->${route.to}: actionsApi=${config.actionsApi}; l1=${config.l1Network}; l2=${config.l2Network}`
			})
			const healthLines = await Promise.all(
				enabledRoutes.map(async (route) => {
					const config = createSdkConfig(route)
					const healthUrl = healthUrlFromGraphqlUrl(config.actionsApi)
					const status = await checkBackendHealth({
						fetchImpl: deps.fetch ?? fetch,
						url: healthUrl
					})
					return `- ${route.from}->${route.to}: ${healthUrl} -> ${status}`
				})
			)
			;(deps.write ?? console.log)(
				[
					"bridge doctor",
					`Data dir: ${paths.dataDir}`,
					`State dir: ${paths.stateDir}`,
					`Log dir: ${paths.logDir}`,
					`Wallet private key: ${keyConfig.ok ? "configured" : keyConfig.message}`,
					...(keyConfig.ok ? [`Signer public key: ${keyConfig.publicKey}`] : []),
					`Known routes: ${KNOWN_ROUTES.map((route) => `${route.from}->${route.to}`).join(", ")}`,
					"Route status:",
					...routeStatusLines,
					"SDK endpoint mapping:",
					...endpointLines,
					"Backend health:",
					...healthLines
				].join("\n")
			)
		}
	})
