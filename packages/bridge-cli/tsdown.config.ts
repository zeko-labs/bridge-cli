import { defineConfig } from "tsdown"

export default defineConfig({
	entry: {
		cli: "./src/cli.ts"
	},
	platform: "node",
	dts: false,
	outputOptions: {
		inlineDynamicImports: true
	},
	tsconfig: "./tsconfig.build.json",
	external: ["o1js"]
})
