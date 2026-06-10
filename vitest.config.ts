import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const bridgeSdkSource = fileURLToPath(new URL("../bridge-sdk/src/index.ts", import.meta.url))
const graphqlSource = fileURLToPath(new URL("../graphql/src/index.ts", import.meta.url))

export default defineConfig({
	resolve: {
		alias: {
			"@zeko-labs/bridge-sdk": bridgeSdkSource,
			"@zeko-labs/graphql": graphqlSource
		}
	},
	test: {
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/**/*.manual.test.ts"],
		testTimeout: 10_000,
		hookTimeout: 10_000,
		teardownTimeout: 10_000
	}
})
