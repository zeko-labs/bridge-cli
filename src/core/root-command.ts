import { defineCommand, type CommandDef } from "citty"
import { createBridgeCommand } from "../commands/bridge"
import { createDoctorCommand } from "../commands/doctor"
import { createDepositCommand, createWithdrawalCommand } from "../commands/direct"
import { createOperationCommand } from "../commands/operation"
import { createTuiCommand } from "../commands/tui"

export const createBridgeCliCommand = (): CommandDef =>
	defineCommand({
		meta: {
			name: "zeko-bridge",
			version: "0.0.0",
			description: "Agent-first CLI for bridging between Mina and Zeko."
		},
		subCommands: {
			bridge: createBridgeCommand(),
			deposit: createDepositCommand(),
			withdrawal: createWithdrawalCommand(),
			operation: createOperationCommand(),
			tui: createTuiCommand(),
			doctor: createDoctorCommand()
		}
	})
