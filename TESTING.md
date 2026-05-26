# Bridge CLI TESTING

This file covers maintainer/operator live validation only. Public CLI usage lives in [README.md](./README.md).

Agent-specific workflow rules live in [AGENTS.md](./AGENTS.md).

## Required Environment

Inline or exported environment variables take priority over every dotenv file. For keys that are not already set in the shell, the CLI loads dotenv files in this order:

- `~/.zeko/.env`
- a sibling `.env` next to the CLI binary
- a sibling `.env` next to the invocation path

Set this key in one of those locations or pass it directly for the command:

- `MINA_PRIVATE_KEY`

Example explicit command environment:

```bash
MINA_PRIVATE_KEY="<wallet private key>" zeko-bridge doctor
```

## Validation Protocol

Bridge validation is not complete until these three tasks have been run in this exact order:

1. one single-command deposit from `mina:testnet` to `zeko:testnet`
2. one single-command withdrawal from `zeko:testnet` to `mina:testnet`
3. one simultaneous run where a deposit command and a withdrawal command are both active at the same time and both progress in parallel

Pass criteria:

- each individual deposit or withdrawal attempt is driven by exactly one long-lived `bridge` process
- that same original process stays alive through completion
- if the wallet already has queued bridge work, that same command clears the relevant queue and continues until the queue is empty and the requested bridge completes
- the simultaneous validation uses two long-lived `bridge` processes, one per direction, and both stay alive through completion

Failure criteria:

- the `bridge` process exits, is interrupted, or loses its terminal session before completion
- the operator replaces the live command with `operation status`, shell loops, or other sidecar polling
- queued work is left behind when the command should have advanced it
- the command stalls, errors, or behaves differently from the protocol assumptions documented below

These checks are manual only. They are excluded from Vitest and are not run by CI.

## One-Command Rule

Hard rule for every live attempt:

- run exactly one high-level `bridge` command per operation
- keep that command alive in one dedicated PTY/background terminal
- monitor that same terminal's stderr and stdout for the life of the attempt
- use that same terminal as the shared source of truth for both the human and the agent
- do not start sidecar `operation status` loops, shell polling loops, or extra monitor processes as part of the validation attempt

Important distinction:

- `operation status` is useful for debugging and recovery after an interruption because it performs fresh SDK/network reads
- it does not advance the bridge, does not sign follow-up transactions, and does not make an interrupted one-command validation count as successful

## Commands

Run from the monorepo root.

Convenience Moon tasks for the two single-direction runs:

```bash
moon run bridge-cli:live-bridge-mina-to-zeko
moon run bridge-cli:live-bridge-zeko-to-mina
```

Those tasks:

- build the local CLI
- run the real `bridge` command directly with `--json --verbose`
- stream progress on stderr
- leave the final JSON result on stdout

Exact one-command equivalents:

```bash
node ./packages/bridge-cli/dist/cli.js bridge --from mina:testnet --to zeko:testnet --amount 1 --json --verbose
```

```bash
node ./packages/bridge-cli/dist/cli.js bridge --from zeko:testnet --to mina:testnet --amount 1 --json --verbose
```

For the simultaneous validation, open two dedicated terminals and keep both alive:

Terminal A:

```bash
node ./packages/bridge-cli/dist/cli.js bridge --from mina:testnet --to zeko:testnet --amount 1 --json --verbose
```

Terminal B:

```bash
node ./packages/bridge-cli/dist/cli.js bridge --from zeko:testnet --to mina:testnet --amount 1 --json --verbose
```

Start the second command while the first command is still running so the two bridge processes overlap in time.

## Monitoring And Reporting

Single-direction runs:

- keep one terminal per run
- check that same terminal at least every 3 minutes
- report what the command is currently waiting on, not just that it is still running

Simultaneous run:

- keep two terminals, one per direction
- check both terminals every 3 minutes
- report whether the two commands are genuinely progressing in parallel or whether one direction is starved behind the other

During reporting, record:

- current phase
- latest meaningful stderr progress line
- whether the command is advancing older queued work first
- any drift from the expected protocol behavior
- any errors, unexpected behavior, or suspicious long waits

Do not rubber-stamp a run as working. The purpose of this validation is to catch bugs and behavioral drift.

## Interpreting Long Waits

During long waits, expect stderr progress lines for:

- submission
- waiting for confirmation
- waiting on earlier queued claims
- retries after transient network/status errors
- periodic heartbeat summaries

Important timing notes:

- after `submitDeposit`, a long `waiting-submission` period is usually Mina L1 visibility/finality delay
- after a deposit has a target index, `canFinalizeDeposit` and `canCancelDeposit` may still wait a long time on sequencer commit/progression
- a long `waiting-finalization` period before any finalize transaction exists does not by itself mean the bridge is stuck
- `Invalid key` is not expected just because a pre-finalize wait is long; that risk starts only after `finalizeDeposit` has been submitted and the server-side proof request then runs for roughly an hour or longer

Queue notes:

- if the wallet already has pending bridge work, the command may advance older claims before it can complete the requested bridge
- that is expected behavior and must be observed rather than treated as a failure by default
- for deposits, a cancellable entry can never also be finalized
- cancellable deposits are skippable in protocol terms, but finalizable deposits must never be skipped

Operator note:

- when checking archive-node action history manually, prefer recent `10_000`-block windows over a `from=0` full-history query

## Artifacts

For every run, keep:

- `operation_id`
- `log_path`
- final transaction hash

For the simultaneous run, keep those artifacts for both commands and note the overlap window during which both processes were alive together.
