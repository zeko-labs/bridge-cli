# @zeko-labs/bridge-cli

## 0.2.2

### Patch Changes

- d27cbf8: Use the Zeko-hosted Mina mainnet gateway endpoints in Bridge CLI defaults and Bridge SDK examples.

## 0.2.1

### Patch Changes

- 1393724: Preserve withdrawal action indexes while status witnesses are still catching up so long-running bridge commands can keep tracking submitted withdrawals. Mark unwitnessed withdrawals finalised when the helper account has advanced past their index. Use the dedicated testnet Actions API endpoint so testnet bridge validation can resolve deposit and withdrawal witnesses.

## 0.2.0

### Minor Changes

- 28eed6c: Enable Mina/Zeko mainnet bridge routes, add bridge CLI route and backend health diagnostics, and use network-specific bridge history windows for SDK deposit and diagnostic lookups.

## 0.1.1

### Patch Changes

- 6ce5e75: Harden bridge CLI signer/account validation, dotenv precedence, transient mutation retries, and SDK deposit queue reporting.

## 0.1.0

### Minor Changes

- 29eb409: Improve deposit queue handling across the bridge SDK and CLI.

  The SDK now exposes per-deposit `cancellable` state and enforces deposit finalization ordering so later deposits cannot bypass earlier non-cancellable deposits, while still allowing older cancellable deposits to be skipped.

  The CLI now follows the same queue rule, preferring cancellation for older skippable deposits and blocking finalization when an earlier non-cancellable deposit still must be resolved.

- 2f0b83a: Fix bridge CLI resume/status handling and bridge SDK status edge cases.

  The CLI now resumes effectively-finalizable deposits correctly in both the long-running `bridge` flow and the account-wide `operation resume-all` flow, clears queued deposits before submitting a new high-level deposit, preserves resumed deposit targets after finalization changes the indexed status hash, uses SDK finalization indexes to avoid applying withdrawal capability results to the wrong queued item, avoids duplicate finalization submissions while status output lags after a finalization hash, renames `operation resume-user` to `operation resume-all`, honors `--timeout-slots` on both `bridge` and direct `deposit submit`, exposes poll/retry delay controls on long-running bridge commands, reports status endpoints and submit-hash visibility while waiting on withdrawal status progress, retries direct deposit submissions on recoverable backend mutation failures, and normalizes bogus status timestamps before rendering them.

  The SDK now normalizes unresolved withdrawal timestamps, treats nullable Actions API commit responses as waiting/non-finalizable status with explicit boolean status fields, reports endpoint URLs in verbose withdrawal action-source diagnostics, reports the selected index from finalization capability checks, and reports a clearer non-finalizable deposit reason when an earlier deposit must be resolved first.

### Patch Changes

- 2f0b83a: Expose only the CLI entrypoint from the published package and simplify shared command plumbing.

## 0.0.1

### Patch Changes

- 40df54c: Fix the bridge CLI release prep by making the manual live-validation tasks runnable, avoiding the bundled `o1js` runtime breakage in the built CLI, and documenting the monorepo Changesets release flow.
