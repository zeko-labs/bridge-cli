# Bridge CLI Agent Notes

Start with [README.md](./README.md) for public CLI behavior.

Use [TESTING.md](./TESTING.md) for the maintainer/operator live-validation procedure and exact command shape.

## Default Path

- Use `zeko-bridge bridge` by default for every normal bridge request.
- Interpret "use the Bridge CLI" as "run the high-level `zeko-bridge bridge` command" unless the user explicitly asks for a specific low-level subcommand.
- For a Mina-to-Zeko deposit request, still run `zeko-bridge bridge --from mina:testnet --to zeko-m:testnet ...`; do not run `zeko-bridge deposit submit`.
- For a Zeko-to-Mina withdrawal request, still run `zeko-bridge bridge --from zeko-m:testnet --to mina:testnet ...`; do not run `zeko-bridge withdrawal submit`.
- Treat `deposit`, `withdrawal`, `operation`, and `tui` as advanced/debug/recovery tools, not default bridge execution paths.
- Keep `README.md` public-facing. Agent-only workflow guidance belongs here, not in the public package README.
- Keep `TESTING.md` procedure-focused. Do not duplicate the full validation checklist here; reference it and add only agent-specific constraints.

## Manual Validation

Follow [TESTING.md](./TESTING.md) exactly for live bridge validation.

Agent-specific rules on top of that procedure:

- Run local source CLI commands from the active PR worktree root, using this worktree's built CLI.
- Select wallets by sourcing one explicit repo-root `.env.wallet.*` file in the shell before invoking the CLI. Do not rely on regular `.env` files for wallet material.
- Keep wallet files in the monorepo root with `PUBLIC_KEY` and `MINA_PRIVATE_KEY`. Do not add CLI-specific wallet-file loading unless the plain env-file approach stops working.
- Use a fresh timestamped wallet file for normal live validation. If the latest deployed validator run failed, also run the same local validation path with `.env.wallet.validator`.
- The CLI rejects an explicit `--account` that does not match the signer public key, so do not add separate preflight checks just to validate that pairing.
- Do not add the live-validation tasks to CI or any automatic local workflow.
- Do not copy release/publish workflow detail into the package README. Internal release guidance already lives in `RELEASE.md` and the repo skills.

## Parallel Subagents

If you split work across subagents:

- one subagent owns `mina:testnet -> zeko-m:testnet`
- one subagent owns `zeko-m:testnet -> mina:testnet`

For real network validation:

- prefer separate funded wallets per direction when you need isolation
- if subagents share a wallet, expect queued-claim ordering behavior and read the streamed progress carefully
- always capture `operation_id`, `log_path`, and final transaction hash from each run
- follow the one-command validation contract in [TESTING.md](./TESTING.md) without adding sidecar polling commands
- read long deposit waits correctly:
  - `waiting-submission` after `submitDeposit` is usually Mina L1 visibility/finality delay
  - `waiting-finalization` before any finalize transaction exists can still be normal sequencer commit delay from `canFinalizeDeposit` / `canCancelDeposit`
  - do not infer proof-request eviction risk until after `finalizeDeposit` has actually been submitted

## Code Landmarks

- durable bridge flow: `src/commands/bridge.ts`
- phase model: `src/core/operation-machine.ts`
- reporter/log rendering: `src/core/reporter.ts`
- manual validation entrypoints: `moon.yml`
