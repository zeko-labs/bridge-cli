type CommandArgs = Record<string, unknown>

export const readOptionalStringArg = (args: CommandArgs, name: string): string | undefined =>
	typeof args[name] === "string" && args[name].length > 0 ? args[name] : undefined

export const readRequiredStringArg = (
	args: CommandArgs,
	name: string,
	message = `Missing required ${name}`
): string => {
	const value = readOptionalStringArg(args, name)
	if (!value) throw new Error(message)
	return value
}

export const readBooleanArg = (args: CommandArgs, name: string, fallback = false): boolean =>
	typeof args[name] === "boolean" ? args[name] : fallback

export const readAliasedStringArg = (
	args: CommandArgs,
	name: string,
	alias: string
): string | undefined => readOptionalStringArg(args, name) ?? readOptionalStringArg(args, alias)

export const readOptionalNumberArg = (args: CommandArgs, name: string): number | undefined => {
	const value = readOptionalStringArg(args, name)
	if (value === undefined) return undefined

	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : undefined
}

export const readAliasedOptionalNumberArg = (
	args: CommandArgs,
	name: string,
	alias: string
): number | undefined => readOptionalNumberArg(args, name) ?? readOptionalNumberArg(args, alias)

export const readNonNegativeNumberArg = (
	args: CommandArgs,
	name: string,
	flag: string
): number | undefined => {
	const value = readOptionalStringArg(args, name)
	if (value === undefined) return undefined

	const parsed = Number(value)
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative number`)
	}

	return parsed
}

export const readAliasedNumberArg = (
	args: CommandArgs,
	name: string,
	alias: string,
	flag: string
): number | undefined =>
	readOptionalStringArg(args, name) !== undefined
		? readNonNegativeNumberArg(args, name, flag)
		: readNonNegativeNumberArg(args, alias, flag)
