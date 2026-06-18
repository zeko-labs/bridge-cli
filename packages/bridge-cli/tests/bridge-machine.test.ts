import { describe, expect, it } from "vitest"
import { createActor, fromPromise, toPromise } from "xstate"
import { bridgeOperationMachine } from "../src/commands/bridge"
import { parseChainRef } from "../src/core/routes"
import type { OperationSession } from "../src/core/types"

const now = () => "2026-05-13T00:00:00.000Z"

const createSession = (patch: Partial<OperationSession> = {}): OperationSession => ({
	id: "operation-1",
	status: "running",
	phase: "submitted",
	route: "mina:testnet->zeko-m:testnet",
	direction: "deposit",
	account: "B62qaccount",
	recipient: "B62qrecipient",
	amount: "1",
	logPath: "",
	createdAt: now(),
	updatedAt: now(),
	submittedTransactions: [{ action: "submit", hash: "5Jsubmit" }],
	...patch
})

const createContext = (session = createSession()) => ({
	session,
	input: {
		id: session.id,
		from: parseChainRef("mina:testnet", "--from"),
		to: parseChainRef("zeko-m:testnet", "--to"),
		amount: session.amount,
		account: session.account,
		recipient: session.recipient
	},
	deps: {
		adapter: {},
		sessionStore: { save: async () => {} },
		log: async () => {},
		sleep: async () => {},
		pollIntervalMs: 0
	},
	waitTracker: { emittedImmediateHeartbeat: false },
	now
})

describe("bridge operation state machine", () => {
	it("names the bridge lifecycle states reviewers need to reason about", () => {
		expect(Object.keys(bridgeOperationMachine.states)).toEqual([
			"route",
			"submittingDeposit",
			"submittingWithdrawal",
			"inspectingDeposit",
			"inspectingWithdrawal",
			"waitingDepositSubmission",
			"waitingDepositPriorClaims",
			"waitingDepositFinalization",
			"waitingWithdrawalSubmission",
			"waitingWithdrawalPriorClaims",
			"waitingWithdrawalFinalization",
			"finalizingDeposit",
			"cancelingDeposit",
			"finalizingWithdrawal",
			"completed",
			"cancelled",
			"failed"
		])
	})

	it("routes wait decisions through the named wait states", async () => {
		const states: string[] = []
		const machine = bridgeOperationMachine.provide({
			actors: {
				inspectDeposit: fromPromise(async ({ input }) => ({
					session: {
						...(input as ReturnType<typeof createContext>).session,
						phase: "waiting-prior-claims" as const
					},
					next: "wait-deposit" as const
				})),
				waitDeposit: fromPromise(async ({ input }) => ({
					session: {
						...(input as ReturnType<typeof createContext>).session,
						status: "completed" as const,
						phase: "completed" as const
					},
					next: "completed" as const
				}))
			}
		})
		const actor = createActor(machine, { input: createContext() })

		actor.subscribe((snapshot) => {
			states.push(String(snapshot.value))
		})
		actor.start()
		await toPromise(actor)

		expect(states).toContain("waitingDepositPriorClaims")
	})
})
