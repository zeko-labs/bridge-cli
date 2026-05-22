import { describe, expect, it } from "vitest"
import { resolveAppPaths } from "../src/core/paths"

describe("paths", () => {
	it("uses xdg-style overrides when present", () => {
		const paths = resolveAppPaths({
			env: {
				XDG_DATA_HOME: "/tmp/data-home",
				XDG_STATE_HOME: "/tmp/state-home",
				XDG_CACHE_HOME: "/tmp/cache-home",
				HOME: "/Users/tester"
			},
			platform: "linux"
		})

		expect(paths.dataDir).toBe("/tmp/data-home/zeko-bridge")
		expect(paths.stateDir).toBe("/tmp/state-home/zeko-bridge")
		expect(paths.logDir).toBe("/tmp/state-home/zeko-bridge/logs")
		expect(paths.cacheDir).toBe("/tmp/cache-home/zeko-bridge")
	})
})
