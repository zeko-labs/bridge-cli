import { describe, expect, it } from "vitest"
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
		const command = createDoctorCommand({
			resolvePaths: () => appPaths,
			resolveKeys: () => ({
				mina: "mina-private-key",
				zeko: "zeko-private-key",
				eth: undefined
			}),
			write: (message) => writes.push(message)
		})

		await command.run?.({ rawArgs: [], args: { _: [] }, cmd: command })

		expect(writes[0]).toContain("bridge doctor")
		expect(writes[0]).toContain("Data dir: /tmp/data")
		expect(writes[0]).toContain("Wallet private key: configured")
		expect(writes[0]).toContain("mina:testnet->zeko:testnet")
	})
})
