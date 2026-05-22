#!/usr/bin/env node

import { runMain } from "citty"
import { loadBridgeCliEnv } from "./core/env"
import { createBridgeCliCommand } from "./core/root-command"

if (process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts")) {
	await loadBridgeCliEnv()
	await runMain(createBridgeCliCommand())
}
