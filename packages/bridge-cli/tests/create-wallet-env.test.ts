import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createWalletEnvFile, formatWalletEnv, walletFileName } from "../scripts/create-wallet-env"

const generatedAt = new Date("2026-06-19T06:00:00.000Z")

describe("create-wallet-env", () => {
	it("formats wallet files with stable variable names", () => {
		expect(formatWalletEnv({ publicKey: "B62qPublic", privateKey: "EKPrivate" })).toBe(
			"PUBLIC_KEY=B62qPublic\nMINA_PRIVATE_KEY=EKPrivate\n"
		)
	})

	it("creates timestamped root wallet files", async () => {
		const root = await mkdtemp(join(tmpdir(), "wallet-env-"))
		const result = await createWalletEnvFile({
			name: "bridge-test",
			root,
			now: generatedAt
		})

		expect(result.fileName).toBe(".env.wallet.bridge-test-20260619T060000Z")
		expect(result.filePath).toBe(join(root, ".env.wallet.bridge-test-20260619T060000Z"))
		expect(await readFile(result.filePath, "utf8")).toBe(
			formatWalletEnv({
				publicKey: result.publicKey,
				privateKey: result.privateKey
			})
		)
		expect(result.publicKey).toMatch(/^B62q/)
		expect(result.privateKey).toMatch(/^EK/)
	})

	it("creates wallet files with owner-only permissions", async () => {
		const root = await mkdtemp(join(tmpdir(), "wallet-env-"))
		const result = await createWalletEnvFile({
			name: "bridge-test",
			root,
			now: generatedAt
		})

		const mode = (await stat(result.filePath)).mode & 0o777
		expect(mode).toBe(0o600)
	})

	it("rejects names that are unsafe for env filenames", () => {
		expect(() => walletFileName("bad/name", generatedAt)).toThrow(
			"Wallet name may only contain letters, numbers, dots, underscores, and hyphens."
		)
	})

	it("does not overwrite an existing wallet file", async () => {
		const root = await mkdtemp(join(tmpdir(), "wallet-env-"))
		const fileName = walletFileName("bridge-test", generatedAt)
		await writeFile(join(root, fileName), "PUBLIC_KEY=existing\nMINA_PRIVATE_KEY=existing\n")

		await expect(
			createWalletEnvFile({
				name: "bridge-test",
				root,
				now: generatedAt
			})
		).rejects.toThrow(`Wallet file already exists: ${join(root, fileName)}`)
	})
})
