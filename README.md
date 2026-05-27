# Bridge CLI

Command-line tool for bridging assets between Mina and Zeko.

Use the `zeko-bridge` binary from the npm package.

## Supported Routes

Enabled routes:

| From           | To             | Direction  |
| -------------- | -------------- | ---------- |
| `mina:testnet` | `zeko:testnet` | Deposit    |
| `zeko:testnet` | `mina:testnet` | Withdrawal |
| `mina:mainnet` | `zeko:mainnet` | Deposit    |
| `zeko:mainnet` | `mina:mainnet` | Withdrawal |

## Installation

Install globally:

```bash
npm install -g @zeko-labs/bridge-cli
```

Then run:

```bash
zeko-bridge bridge --from mina:testnet --to zeko:testnet --amount 1
zeko-bridge bridge --from mina:mainnet --to zeko:mainnet --amount 1
```

Or run without a global install:

```bash
npx -y @zeko-labs/bridge-cli bridge --from mina:testnet --to zeko:testnet --amount 1
```

## Configuration

The currently enabled routes use one Mina-compatible private key:

| Variable           | Required | Description                                                           |
| ------------------ | -------- | --------------------------------------------------------------------- |
| `MINA_PRIVATE_KEY` | Yes      | Private key used to sign supported Mina and Zeko bridge transactions. |

You can export it in your shell:

```bash
export MINA_PRIVATE_KEY="<wallet private key>"
```

For local CLI use, `zeko-bridge` also loads dotenv files. Inline or exported environment variables take precedence over every dotenv file:

```bash
MINA_PRIVATE_KEY="<wallet private key>" zeko-bridge bridge --from mina:testnet --to zeko:testnet --amount 1
```

For keys that are not already set in the shell, the first readable dotenv file that provides the key wins. The recommended dotenv file is:

```text
~/.zeko/.env
```

with:

```dotenv
MINA_PRIVATE_KEY=
```

## Commands

| Command                 | Use                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `bridge`                | Recommended full bridge flow. Submits, waits, finalizes or cancels as needed, and prints the result. |
| `operation list`        | Lists locally persisted operations.                                                                  |
| `operation completed`   | Lists completed and cancelled operations.                                                            |
| `operation status <id>` | Refreshes one operation from current network state and prints status JSON.                           |
| `operation logs <id>`   | Prints the JSONL event log for one operation.                                                        |
| `operation resume <id>` | Continues a persisted operation after interruption.                                                  |
| `operation resume-all`  | Discovers and resumes pending bridge work for an account.                                            |
| `deposit submit`        | Low-level deposit submit.                                                                            |
| `deposit finalize`      | Low-level deposit finalization.                                                                      |
| `deposit cancel`        | Low-level deposit cancellation.                                                                      |
| `deposit status`        | Low-level deposit status lookup.                                                                     |
| `withdrawal submit`     | Low-level withdrawal submit.                                                                         |
| `withdrawal finalize`   | Low-level withdrawal finalization.                                                                   |
| `withdrawal status`     | Low-level withdrawal status lookup.                                                                  |
| `tui`                   | Opens the terminal UI for operations and logs.                                                       |
| `doctor`                | Prints local path, signer, and route diagnostics.                                                    |

## Full Bridge Flow

Use `bridge` for normal bridging. It submits the bridge transaction, waits for network state to become claimable, performs the required finalize or cancel action, persists progress, and prints the final result.

```bash
zeko-bridge bridge --from mina:testnet --to zeko:testnet --amount 1
zeko-bridge bridge --from zeko:testnet --to mina:testnet --amount 3 --recipient B62q...
zeko-bridge bridge --from mina:mainnet --to zeko:mainnet --amount 1
zeko-bridge bridge --from zeko:mainnet --to mina:mainnet --amount 3 --recipient B62q...
zeko-bridge bridge --from mina:testnet --to zeko:testnet --amount 1 --json
zeko-bridge bridge --from zeko:testnet --to mina:testnet --amount 3 --json
```

Both directions can take a long time. A bridge command staying open for many minutes or even hours is normal: the CLI is waiting for chain visibility, bridge queue state, and finalization readiness. Keep the process running until it prints the final result.

Flags:

| Flag                 | Default                                   | Description                                                                                  |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `--from`             | `mina:testnet`                            | Source chain.                                                                                |
| `--to`               | `zeko:testnet`                            | Destination chain.                                                                           |
| `--amount`           | Required                                  | Amount in MINA units.                                                                        |
| `--account`          | Optional, derived from `MINA_PRIVATE_KEY` | Source account to use for bridge status and transaction requests. Most users should omit it. |
| `--recipient`        | Source account                            | Destination account.                                                                         |
| `--timeout-slots`    | Route default                             | Deposit timeout override for Mina-to-Zeko deposits.                                          |
| `--poll-interval-ms` | `20000`                                   | Delay between bridge status polls while waiting.                                             |
| `--retry-delay-ms`   | `5000`                                    | Delay before retrying transient network or bridge service errors.                            |
| `--json`             | `false`                                   | Print the final result as JSON on stdout. Progress remains on stderr.                        |
| `--verbose`          | `false`                                   | Record and print SDK call diagnostics and wait reasons.                                      |

The command is designed to be left running until completion. Long waits can be normal while the source chain transaction becomes visible, while earlier queued bridge work is claimed, or while the destination chain becomes ready for finalization.

## Result JSON

With `--json`, `bridge`, `operation resume`, and `operation resume-all` print machine-readable results.

Example `bridge --json` result:

```json
{
	"success": true,
	"operation_id": "f3d3d12a-8a1c-4b8b-9a1e-2a6e6bc7a1d7",
	"route": "mina:testnet->zeko:testnet",
	"direction": "deposit",
	"status": "completed",
	"amount": "1",
	"recipient": "B62qexample",
	"submitted_transactions": [
		{ "action": "submit", "hash": "5Jsubmit" },
		{ "action": "finalize", "hash": "5Jfinalize" }
	],
	"final_transaction": {
		"action": "finalize",
		"hash": "5Jfinalize",
		"explorerUrl": "https://zekoscan.io/testnet/tx/5Jfinalize"
	},
	"explorer_urls": ["https://zekoscan.io/testnet/tx/5Jfinalize"],
	"log_path": "/Users/example/Library/Logs/zeko-bridge/f3d3d12a-8a1c-4b8b-9a1e-2a6e6bc7a1d7.jsonl",
	"error": null
}
```

When `--verbose` is enabled, the JSON result can also include `verbose_diagnostics` with SDK call counts, timings, and capability wait reasons.

## Low-Level Commands

The low-level `deposit` and `withdrawal` commands expose individual bridge actions. They are useful for recovery, debugging, and operator workflows. For normal bridging, prefer `bridge`.

Common flags:

| Flag        | Description                                                                               |
| ----------- | ----------------------------------------------------------------------------------------- |
| `--from`    | Source chain. Defaults to the route's source testnet.                                     |
| `--to`      | Destination chain. Defaults to the route's destination testnet.                           |
| `--account` | Optional account to operate on. Defaults to the signer public key.                        |
| `--json`    | Print JSON instead of formatted text.                                                     |
| `--verbose` | Enable verbose bridge diagnostics where supported.                                        |
| `--wait`    | Wait for submitted transactions to be included. Defaults to `true` for mutation commands. |

Deposit-specific flags:

| Command          | Extra flags                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| `deposit submit` | `--amount`, `--timeout-slots`                                                     |
| `deposit status` | `--latest` to return only the latest deposit for the account. Defaults to `true`. |

Withdrawal-specific flags:

| Command             | Extra flags                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ |
| `withdrawal submit` | `--amount`                                                                           |
| `withdrawal status` | `--latest` to return only the latest withdrawal for the account. Defaults to `true`. |

## Operation Commands

Bridge operations are persisted so they can be inspected or resumed after interruption.

```bash
zeko-bridge operation list
zeko-bridge operation completed
zeko-bridge operation status <operation-id>
zeko-bridge operation logs <operation-id>
zeko-bridge operation resume <operation-id>
zeko-bridge operation resume-all --from mina:testnet --to zeko:testnet
```

Commands:

| Command                 | Description                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `operation list`        | Prints all locally persisted operations as JSON.                                                                                                       |
| `operation completed`   | Lists completed and cancelled operations. Use `--json` for JSON output.                                                                                |
| `operation status <id>` | Refreshes one operation from current network state, saves the refreshed state, and prints status JSON. Use `--verbose` for verbose bridge diagnostics. |
| `operation logs <id>`   | Prints the JSONL event log for one operation.                                                                                                          |
| `operation resume <id>` | Continues a persisted operation. Supports `--json`, `--verbose`, `--poll-interval-ms`, and `--retry-delay-ms`.                                         |
| `operation resume-all`  | Discovers pending deposits and withdrawals for an account, matches them to persisted sessions when possible, and resumes them sequentially.            |

`operation resume-all` flags:

| Flag                 | Default                                   | Description                                           |
| -------------------- | ----------------------------------------- | ----------------------------------------------------- |
| `--from`             | `mina:testnet`                            | Route source used for queue discovery.                |
| `--to`               | `zeko:testnet`                            | Route destination used for queue discovery.           |
| `--account`          | Optional, derived from `MINA_PRIVATE_KEY` | Account whose pending bridge queue should be resumed. |
| `--poll-interval-ms` | `20000`                                   | Delay between status polls.                           |
| `--retry-delay-ms`   | `5000`                                    | Delay before retrying transient errors.               |
| `--json`             | `false`                                   | Print JSON output.                                    |
| `--verbose`          | `false`                                   | Enable verbose bridge diagnostics.                    |

`operation status` JSON includes stable operation fields plus live fields when they are available:

- `phase`, `status`, `route`, `direction`, `account`, `recipient`, `amount`
- `submitted_transactions`, `final_transaction`, `error`
- `target_index`, `claimable_index`, `pending_ahead`
- `can_finalize`, `can_cancel`, `next_action`, `waiting_on`
- `observed_counts` and `status_sources` for status endpoint visibility

## TUI And Doctor

Open the terminal UI:

```bash
zeko-bridge tui
zeko-bridge tui <operation-id>
```

The TUI shows active and completed operations, selected operation details, and recent log lines.

Check local configuration:

```bash
zeko-bridge doctor
```

`doctor` prints the data, state, log, and cache directories, signer configuration status, known bridge route status, SDK endpoint mapping, and Actions API health/readiness URLs.

## Logs And State

`zeko-bridge` stores operation state and logs in OS-standard application directories:

| Platform | State and logs                                                                     |
| -------- | ---------------------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/zeko-bridge/state` and `~/Library/Logs/zeko-bridge` |
| Linux    | `$XDG_STATE_HOME/zeko-bridge` or `~/.local/state/zeko-bridge`                      |
| Windows  | `%LOCALAPPDATA%\zeko-bridge\state` and `%LOCALAPPDATA%\zeko-bridge\logs`           |

Use `zeko-bridge doctor` to see the exact paths on your machine. Use `zeko-bridge operation logs <operation-id>` to inspect a specific operation log.

## Protocol Notes

- Mina-originated deposits can spend a long time waiting for source-chain visibility before a target index is observed.
- Deposit finalization and cancellation depend on bridge capability checks. A wait in `waiting-finalization` can mean the destination chain has not committed enough state yet.
- Earlier queued bridge work may need to be finalized or cancelled before the requested operation can complete.
- If an earlier deposit is cancellable, the CLI can cancel it to unblock the queue. If an earlier deposit is finalizable, the CLI finalizes it before moving on.
- Withdrawals require the withdrawal to be committed before it can be finalized on the destination chain.
- If a post-finalize proof request runs for too long and the bridge service returns `Invalid key`, the command treats that response as terminal.
