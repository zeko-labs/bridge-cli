import { readAliasedStringArg } from "./command-args"

type CommandArgs = Record<string, unknown>
type EndpointOverrideArg = { type: "string"; required: false; alias: string[] }

export type BridgeEndpointOverrides = {
	readonly actionsApi?: string
	readonly l1Url?: string
	readonly l1ArchiveUrl?: string
}

export const bridgeEndpointOverrideArgs: Record<
	keyof BridgeEndpointOverrides,
	EndpointOverrideArg
> = {
	actionsApi: { type: "string", required: false, alias: ["actions-api"] },
	l1Url: { type: "string", required: false, alias: ["l1-url"] },
	l1ArchiveUrl: { type: "string", required: false, alias: ["l1-archive-url"] }
}

export const readBridgeEndpointOverrides = (args: CommandArgs): BridgeEndpointOverrides => {
	const actionsApi = readAliasedStringArg(args, "actionsApi", "actions-api")
	const l1Url = readAliasedStringArg(args, "l1Url", "l1-url")
	const l1ArchiveUrl = readAliasedStringArg(args, "l1ArchiveUrl", "l1-archive-url")

	return {
		...(actionsApi ? { actionsApi } : {}),
		...(l1Url ? { l1Url } : {}),
		...(l1ArchiveUrl ? { l1ArchiveUrl } : {})
	}
}
