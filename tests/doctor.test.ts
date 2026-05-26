import { describe, expect, it } from "vitest"
import { PrivateKey } from "o1js"
import { createDoctorCommand } from "../src/commands/doctor"
import type { AppPaths } from "../src/core/paths"

const appPaths: AppPaths = {
	dataDir: "/tmp/data",
	stateDir: "/tmp/state",
	logDir: "/tmp/logs",
	cacheDir: "/tmp/cache"
}

describe("doctor command", () => {
	it("reports configured paths, keys, and known routes", async () => {
		const writes: string[] = []
		const signer = PrivateKey.random()
		const command = createDoctorCommand({
			resolvePaths: () => appPaths,
			resolveKeys: () => ({
				mina: signer.toBase58(),
				zeko: signer.toBase58(),
				eth: undefined
			}),
			write: (message) => writes.push(message)
		})

		await command.run?.({ rawArgs: [], args: { _: [] }, cmd: command })

		expect(writes[0]).toContain("bridge doctor")
		expect(writes[0]).toContain("Data dir: /tmp/data")
		expect(writes[0]).toContain("Wallet private key: configured")
		expect(writes[0]).toContain(`Signer public key: ${signer.toPublicKey().toBase58()}`)
		expect(writes[0]).toContain("mina:testnet->zeko:testnet")
	})
})
