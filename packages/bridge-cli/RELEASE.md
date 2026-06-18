# Release Process

The bridge CLI is developed in the private `zeko-ui` monorepo. Changesets, versioning, building, npm publishing, GitHub releases, and public-repo syncing all run from the monorepo. The standalone `zeko-labs/bridge-cli` repo is a public source mirror for the CLI and the internal source packages it needs.

## Architecture

```text
zeko-ui (monorepo)                              zeko-labs/bridge-cli (public mirror)
┌────────────────────────────┐                  ┌──────────────────────────┐
│ .changeset/config.json     │                  │ /                        │
│   └── bridge-cli release   │                  │ ├── packages/bridge-cli/ │
│                            │                  │ │   ├── src/             │
│ packages/bridge-cli/       │──── sync ────▶   │ │   └── package.json     │
│   ├── src/                 │  force-push      │ ├── packages/networks/   │
│   ├── dist/ (built in CI)  │  clean commit    │ │   ├── src/             │
│   ├── README.md            │                  │ │   └── package.json     │
│   └── package.json         │                  │ ├── pnpm-workspace.yaml  │
│                            │                  │ └── .moon/workspace.yml  │
│ packages/networks/         │                  │                          │
│   ├── src/                 │                  │ No release CI            │
│   └── package.json         │                  │ No .changeset/           │
│                            │                  └──────────────────────────┘
│ .github/workflows/         │
│   ├── changesets.yaml                ── orchestrator (version PR + triggers)
│   ├── release-bridge-cli.yaml        ── build + pack + npm publish
│   ├── github-release-bridge-cli.yaml ── GitHub release on mirror
│   └── sync-bridge-cli.yaml           ── force-push to mirror
└────────────────────────────┘
```

## Flow

```text
1. pnpm changeset          → add changeset in monorepo
2. Push to main            → changesets.yaml creates "Version Packages" PR
3. Merge version PR        → changesets.yaml detects no pending changesets
                           → calls release-bridge-cli.yaml
                             → version-check (skip if already on npm)
                             → moon run bridge-cli:build
                             → pnpm pack packages/bridge-cli
                             → npm publish <tarball> via OIDC
                           → sync-bridge-cli.yaml force-pushes the source mirror
                           → github-release-bridge-cli.yaml creates/releases tarball on mirror
```

## Versioning With Changesets

`@zeko-labs/bridge-cli` is versioned by Changesets from the monorepo. `changesets.yaml` runs on every push to `main`:

- Pending changesets exist: runs `pnpm changeset version` and opens a `release: version packages` PR.
- No pending changesets: triggers `release-bridge-cli.yaml`.

## Workflows

### `changesets.yaml` — orchestrator

Runs `changesets/action@v1` with `version` only. When `hasChangesets` is `false`, it fans out bridge-cli release steps as separate downstream jobs:

- `release-bridge-cli` for version-check, build, pack, and npm publish
- `sync-bridge-cli` for force-pushing the standalone source mirror
- `github-release-bridge-cli` for the standalone GitHub release after sync completes

### `release-bridge-cli.yaml` — build, pack, and publish

Triggered by `workflow_call` from `changesets.yaml`. It checks whether the current version is already on npm, builds the package with `moon run bridge-cli:build`, creates a single tarball with `pnpm pack`, then publishes that tarball with `npm publish` using npm trusted publishing.

This package does not use platform subpackages. The published artifact is the built JavaScript tarball for `@zeko-labs/bridge-cli`.

### `github-release-bridge-cli.yaml` — GitHub release

Creates a GitHub release on `zeko-labs/bridge-cli` and attaches the packaged npm tarball from the monorepo release run after the mirror sync finishes, so the release tag points at the synced standalone source files. On reruns, it re-uploads assets to an existing release instead of failing on an existing tag.

### `sync-bridge-cli.yaml` — public source mirror

Assembles a temporary public source monorepo, then force-pushes it to `zeko-labs/bridge-cli`. The mirror includes `packages/bridge-cli` and `packages/networks` so the CLI source keeps importing the shared network nomenclature package instead of duplicating it. npm publication remains separate: `release-bridge-cli.yaml` builds `packages/bridge-cli`, packs the generated `dist/cli.js`, and publishes that tarball from the private monorepo.

- resolves `catalog:` versions
- resolves `workspace:` versions using the bridge-sdk and graphql package manifests
- preserves the local `@zeko/networks` workspace dependency because that package is included in the mirror
- injects the root `packageManager`
- writes a standalone `pnpm-workspace.yaml`

## Trusted Publishing Notes

The npm package must be configured for trusted publishing on npmjs.com:

1. Package: `@zeko-labs/bridge-cli`
2. GitHub organization: `zeko-labs`
3. Repository: `zeko-ui`
4. Trusted workflow filename: `changesets.yaml`

Use the caller workflow filename, not `release-bridge-cli.yaml`. npm validates the OIDC token against the caller when a reusable workflow is invoked through `workflow_call`.

Because the monorepo is private, the release workflow publishes with `NPM_CONFIG_PROVENANCE=false`.

## Initial Package Claim

The first release of a new npm package cannot use OIDC alone. Claim the package name once with a manual publish:

```sh
bun scripts/npm-init-publish.ts packages/bridge-cli --otp <code>
```

After that:

1. configure the trusted publisher for `@zeko-labs/bridge-cli`
2. run the normal changesets-driven release flow

## Creating a Release

### Step 1: Add a changeset

```sh
pnpm changeset
```

Select `@zeko-labs/bridge-cli` and choose the bump type.

### Step 2: Push the changeset

```sh
git add .changeset/
git commit -m "release: bump bridge-cli"
git push
```

### Step 3: Merge the version PR

The changesets workflow creates a PR titled `release: version packages`. Review and merge it.

### Step 4: Automatic build and publish

Once the version PR is merged, the release pipeline builds the package, publishes the tarball to npm, creates a GitHub release on `zeko-labs/bridge-cli`, and syncs the mirror repo.

## Secrets

| Secret                         | Where    | Purpose                                  |
| ------------------------------ | -------- | ---------------------------------------- |
| `GITHUB_TOKEN`                 | monorepo | Default token for changesets version PRs |
| `ZEKO_LABS_GH_APP_ID`          | monorepo | GitHub App ID for cross-repo operations  |
| `ZEKO_LABS_GH_APP_PRIVATE_KEY` | monorepo | GitHub App private key                   |

## Files Overview

| File                                               | Purpose                                     |
| -------------------------------------------------- | ------------------------------------------- |
| `.changeset/config.json`                           | Marks bridge-cli as a published package     |
| `.github/workflows/changesets.yaml`                | Orchestrator: version PRs + downstream jobs |
| `.github/workflows/release-bridge-cli.yaml`        | Build, pack tarball, and publish to npm     |
| `.github/workflows/github-release-bridge-cli.yaml` | GitHub release on the public mirror         |
| `.github/workflows/sync-bridge-cli.yaml`           | Force-push source to the public mirror      |
| `packages/bridge-cli/README.md`                    | Public install and development entrypoint   |
| `packages/bridge-cli/RELEASE.md`                   | Release and mirror maintenance guide        |
