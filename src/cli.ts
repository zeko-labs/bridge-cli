#!/usr/bin/env node

import { runMain } from "citty"
import { loadBridgeCliEnv } from "./core/env"
import { createBridgeCliCommand } from "./core/root-command"

await loadBridgeCliEnv()
await runMain(createBridgeCliCommand())
