# Bridge CLI TESTING

This file covers maintainer/operator live validation only. Public CLI usage lives in [README.md](./README.md).

Agent-specific workflow rules live in [AGENTS.md](./AGENTS.md).

## Required Environment

Live validation must use explicit repo-root wallet files. Do not keep bridge wallet keys in regular `.env` files and do not rely on implicit dotenv discovery for wallet selection.

Wallet files:

- live under the monorepo root
- are named `.env.wallet.${name}`
- contain the same variable names for every wallet:

```bash
PUBLIC_KEY=...
MINA_PRIVATE_KEY=...
```

Create a fresh timestamped test wallet file for normal live validation:

```bash
moon run bridge-cli:create-wallet-env -- --name bridge-test
```

Record the printed wallet file path and `PUBLIC_KEY`. Fund that fresh wallet by moving `3` MINA from `.env.wallet.validator` to the fresh wallet public key on Mina testnet before starting a deposit command. Confirm the fresh wallet balance after funding.

A fresh wallet removes historical queue ambiguity. It does not make bridge operations fast. Budget at least 2 hours for each real-network bridge command; current normal operation time can still be around 1h40 even with a fresh wallet.

Withdrawal validation has one extra funding preflight. A brand-new L1 recipient needs the withdrawal amount to cover the bridge proof fee, helper account creation if the L1 helper-token account does not exist, and recipient payout account creation if the normal L1 recipient account does not exist. For a fully fresh recipient, the minimum amount is `2 * l1AccountCreationFee + bridgeProofFee`; after the normal L1 recipient account exists, the first helper-account withdrawal minimum drops to `l1AccountCreationFee + bridgeProofFee`. The source Zeko balance must also cover the withdrawal amount plus the bridge proof fee paid on submission. Before starting a fresh-wallet withdrawal, read the current bridge fees and confirm the wallet's Zeko balance is sufficient for the selected `--amount`; do not reuse an amount-1 deposit wallet for an amount-1 first withdrawal if it only has the post-deposit remainder on Zeko. If the balance is too low, fund the same timestamped wallet through a larger deposit or use a separate timestamped withdrawal wallet with sufficient Zeko balance. Record which path was used.

Load the wallet file in the same shell before invoking the CLI:

```bash
set -a
. ./.env.wallet.bridge-test-YYYYMMDDTHHMMSSZ
set +a

node ./packages/bridge-cli/dist/cli.js doctor
```

The CLI already reads `MINA_PRIVATE_KEY`; no wallet-file-specific CLI logic is required. The `PUBLIC_KEY` line is for human/tooling confirmation and funding.

## Validation Protocol

Before running bridge validation:

1. check the latest deployed validator result and logs
2. create a fresh timestamped wallet file for the test run
3. fund that fresh wallet from `.env.wallet.validator` by moving `3` MINA to the fresh wallet public key on Mina testnet
4. confirm the fresh wallet public key and balance before starting the bridge command
5. capture surrounding state before the bridge command starts: L1 live status, L1 archive canonical/pending height, L2 archive canonical/pending height, Zeko sequencer public key, latest L1 bridge commit timestamp, latest L2/sequencer bridge commit timestamp, Actions API health, and indexer fetched/final progress when an indexer is involved
6. if validating a local Actions API/indexer change, pass `--actions-api http://127.0.0.1:9100/graphql` to the CLI instead of editing source endpoint config
7. before a fresh-wallet withdrawal, confirm the selected amount is valid for first-withdrawal fees and that the wallet has enough Zeko balance for amount plus proof fee

Bridge validation is not complete until these tasks have been run in this exact order:

1. one single-command deposit from `mina:testnet` to `zeko-m:testnet`
2. one single-command withdrawal from `zeko-m:testnet` to `mina:testnet`
3. one simultaneous run where a deposit command and a withdrawal command are both active at the same time and both progress in parallel

If the latest deployed validator run failed, also reproduce locally with `.env.wallet.validator`. That validator-wallet run is required in addition to fresh-wallet validation, not instead of it.

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

Load the chosen wallet file first:

```bash
set -a
. ./.env.wallet.bridge-test-YYYYMMDDTHHMMSSZ
set +a
```

Convenience Moon tasks for the two single-direction runs:

```bash
moon run bridge-cli:live-bridge-mina-to-zeko
moon run bridge-cli:live-bridge-zeko-to-mina
```

Those tasks:

- build the local CLI
- run the real `bridge` command directly with `--json --verbose`
- emit a verbose `bridge-status` line before the operation starts
- stream progress on stderr
- leave the final JSON result on stdout

The `bridge-status` line should include the latest L1 bridge commit timestamp, latest L2/sequencer bridge commit timestamp, sequencer public key, archive heights, current bridge slot threshold, and the latest L1 commit's synchronized outer action length and slot range. Those fields are diagnostic context, not pass/fail gates by themselves.

Exact one-command equivalents, using an amount that is valid for the wallet balance and route fees:

```bash
node ./packages/bridge-cli/dist/cli.js bridge --from mina:testnet --to zeko-m:testnet --amount 1 --json --verbose --actions-api http://127.0.0.1:9100/graphql
```

```bash
node ./packages/bridge-cli/dist/cli.js bridge --from zeko-m:testnet --to mina:testnet --amount 1 --json --verbose --actions-api http://127.0.0.1:9100/graphql
```

The withdrawal example uses amount `1` only when that amount passes the fee and balance preflight for the loaded wallet. For a fresh first withdrawal, choose an amount and prior funding path that leave enough Zeko balance for the withdrawal amount plus bridge proof fee, and enough withdrawal amount to satisfy `2 * l1AccountCreationFee + bridgeProofFee`.

Endpoint overrides:

- use `--actions-api` for a local Actions API/indexer stack
- use `--l1-url` when the live Mina GraphQL endpoint is part of the diagnosis, for example to compare the default gateway with another responsive live node
- use `--l1-archive-url` when the Mina archive endpoint is part of the diagnosis

The same endpoint override flags are accepted by `bridge`, `operation status`, `operation resume`, `operation resume-all`, and the low-level `deposit` and `withdrawal` commands. Omit endpoint overrides when validating against the deployed route defaults.

For the simultaneous validation, open two dedicated terminals and keep both alive:

Terminal A:

```bash
set -a
. ./.env.wallet.bridge-test-YYYYMMDDTHHMMSSZ
set +a
node ./packages/bridge-cli/dist/cli.js bridge --from mina:testnet --to zeko-m:testnet --amount 1 --json --verbose
```

Terminal B:

```bash
set -a
. ./.env.wallet.bridge-test-YYYYMMDDTHHMMSSZ
set +a
node ./packages/bridge-cli/dist/cli.js bridge --from zeko-m:testnet --to mina:testnet --amount 1 --json --verbose
```

When validating a local Actions API/indexer change, add the same `--actions-api http://127.0.0.1:9100/graphql` flag to both simultaneous commands. If an L1 live or archive override is part of the diagnosis, add that same override to both commands and to any later `operation status` or `operation resume` recovery command for the same operation. Start the second command while the first command is still running so the two bridge processes overlap in time.

## Monitoring And Reporting

Single-direction runs:

- keep one terminal per run
- check that same terminal about every 5 minutes
- report what the command is currently waiting on, not just that it is still running
- keep the command alive for at least 2 hours before treating a real-network fresh-wallet run as timed out, unless the command exits or produces a definitive error earlier

Simultaneous run:

- keep two terminals, one per direction
- check both terminals about every 5 minutes
- report whether the two commands are genuinely progressing in parallel or whether one direction is starved behind the other

During reporting, record:

- current phase
- latest meaningful stderr progress line
- whether the command is advancing older queued work first
- any drift from the expected protocol behavior
- any errors, unexpected behavior, or suspicious long waits
- surrounding state relevant to the wait, including Actions API health/readiness when available, L1 archive height, L2 archive height, Zeko sequencer response, latest L1 bridge commit timestamp, latest L2/sequencer bridge commit timestamp, latest L1 synchronized outer action length, latest L1 commit slot range, current deposit commit past-slot threshold, and latest indexer/commit progress exposed by the current tools

When `--verbose` is enabled, the CLI should print this context in its initial `bridge-status` line. The most useful fields for deposit waits are:

- `bridgeCurrentSlot`
- `bridgeWithdrawalDelaySlots`
- `bridgeDepositCommitPastSlot`
- `l1LastCommitSynchronizedOuterActionStateLength`
- `l1LastCommitSlotRangeLower`
- `l1LastCommitSlotRangeUpper`
- `l1LastCommitTimestamp`
- `sequencerLastCommitTimestamp`

If that line is missing or the status snapshot fails, record the failure and manually query the same state before continuing the interpretation.

Do not rubber-stamp a run as working. The purpose of this validation is to catch bugs and behavioral drift.

## Layer Classification Checklist

Use these as diagnostic signals, not a rigid decision tree. If evidence contradicts the expected category, follow the contradiction and record it.

Treat L1 archive finality or canonicality as the likely blocker when the target deposit block or required outer commit block is above L1 archive `canonicalMaxBlockHeight`, the indexer has fetched close to L1 archive pending height with zero consecutive errors, and Actions API shows a final outer commit plus a pending outer tail beyond it.

Treat the Actions indexer as the likely blocker when L1 archive canonical height has passed the needed block but the indexer final outer block remains stale, the indexer has consecutive errors, `lastFetchedBlock.outer` is far behind L1 archive pending height, or a local indexer advances beyond production against the same archive endpoints.

Treat sequencer commit production as the likely blocker when L2 withdrawals are visible and canonical but pending outer commits do not advance across two 5-minute checks, or when pending commits repeat stale `innerActionStateLength` or stale `synchronizedOuterActionStateLength`.

Treat Actions API query semantics as the likely blocker when the indexer database has the expected pending or final rows but API queries used by the CLI do not return them. Compare deployed API semantics before changing validator timeouts; a canonical-only query can turn an expected pending-inclusion wait into an apparent 24-hour finality wait.

Treat CLI or validator behavior as the likely blocker when direct SDK checks show a deposit or withdrawal is finalizable, but the high-level `bridge` command does not submit the finalization transaction, exits on a diagnostic-only read, loses local session state, or reports success without submitting the expected transaction for the requested fresh operation.

When direct checks leave indexer health ambiguous, run a local indexer with an isolated database and the same public archive endpoints, bridge public keys, and finality settings as production. Record local `lastFetchedBlock.outer`, local final outer index/block, production final outer index/block, L1 archive canonical/pending heights, and the target deposit block or withdrawal commit block.

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
- if the latest L1 bridge commit already has `l1LastCommitSynchronizedOuterActionStateLength` at or beyond the target deposit index, but `l1LastCommitSlotRangeUpper` is still above `bridgeDepositCommitPastSlot`, the commit is visible but not yet usable for that deposit finalization proof
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
- wallet file name and `PUBLIC_KEY`

For the simultaneous run, keep those artifacts for both commands and note the overlap window during which both processes were alive together.
