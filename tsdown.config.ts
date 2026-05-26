import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["./src/cli.ts"],
	platform: "node",
	dts: false,
	outputOptions: {
		inlineDynamicImports: true
	},
	tsconfig: "./tsconfig.build.json",
	external: ["o1js"]
})
