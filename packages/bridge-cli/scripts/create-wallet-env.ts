#!/usr/bin/env node
import { type FileHandle, mkdir, open } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { PrivateKey } from "o1js"

export type WalletEnv = {
	publicKey: string
	privateKey: string
}

export type CreateWalletEnvFileInput = {
	name: string
	root?: string
	now?: Date
	privateKey?: string
}

export type CreateWalletEnvFileResult = WalletEnv & {
	fileName: string
	filePath: string
}

const walletNamePattern = /^[A-Za-z0-9._-]+$/

export const timestampForFile = (date: Date): string =>
	date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z")

export const walletFileName = (name: string, now = new Date()): string => {
	if (!walletNamePattern.test(name)) {
		throw new Error(
			"Wallet name may only contain letters, numbers, dots, underscores, and hyphens."
		)
	}

	return `.env.wallet.${name}-${timestampForFile(now)}`
}

export const formatWalletEnv = ({ publicKey, privateKey }: WalletEnv): string =>
	`PUBLIC_KEY=${publicKey}\nMINA_PRIVATE_KEY=${privateKey}\n`

export const createWalletEnvFile = async ({
	name,
	root = process.cwd(),
	now = new Date(),
	privateKey
}: CreateWalletEnvFileInput): Promise<CreateWalletEnvFileResult> => {
	const signer = privateKey === undefined ? PrivateKey.random() : PrivateKey.fromBase58(privateKey)
	const wallet = {
		publicKey: signer.toPublicKey().toBase58(),
		privateKey: signer.toBase58()
	}
	const fileName = walletFileName(name, now)
	const filePath = join(root, fileName)

	await mkdir(root, { recursive: true })

	let file: FileHandle
	try {
		file = await open(filePath, "wx", 0o600)
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			throw new Error(`Wallet file already exists: ${filePath}`)
		}
		throw error
	}

	try {
		await file.writeFile(formatWalletEnv(wallet), "utf8")
	} finally {
		await file.close()
	}

	return {
		...wallet,
		fileName,
		filePath
	}
}

const readRequiredValue = (args: string[], index: number, flag: string): string => {
	const value = args[index + 1]
	if (value === undefined || value.startsWith("--")) {
		throw new Error(`Missing value for ${flag}`)
	}

	return value
}

const parseArgs = (args: string[]): { name: string; root?: string } => {
	let name: string | undefined
	let root: string | undefined

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === "--name") {
			name = readRequiredValue(args, index, arg)
			index += 1
			continue
		}
		if (arg === "--root") {
			root = readRequiredValue(args, index, arg)
			index += 1
			continue
		}
		if (arg === "--help" || arg === "-h") {
			throw new Error(
				"Usage: node packages/bridge-cli/scripts/create-wallet-env.ts --name <name> [--root <repo-root>]"
			)
		}
		if (arg.startsWith("--")) {
			throw new Error(`Unknown option: ${arg}`)
		}
		if (name !== undefined) {
			throw new Error(`Unexpected argument: ${arg}`)
		}
		name = arg
	}

	if (name === undefined) {
		throw new Error("Missing required --name <name>")
	}

	return { name, root }
}

const main = async () => {
	const input = parseArgs(process.argv.slice(2))
	const result = await createWalletEnvFile(input)
	console.log(`Created ${result.filePath}`)
	console.log(`PUBLIC_KEY=${result.publicKey}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
