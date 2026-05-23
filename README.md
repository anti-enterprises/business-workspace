# business-workspace

Business workspace for directive-driven GTM operations.

Mental model:

`Directives (intent) -> Orchestration + Context (reasoning/knowledge) -> Execution (deterministic tools)`

## What This Repo Is

This repository is a business workspace, not a fullstack web app. It is organized so human-readable directives define intent, orchestration and context drive decisions, and deterministic TypeScript tools perform execution.

## Directory Guide

| Directory | Purpose |
| --- | --- |
| `directives/` | Human-readable SOPs and intent definitions. |
| `orchestration/` | Coordination layer for routing, workflows, agents, apps, skills, and triggers. |
| `context/` | Business/system knowledge used during orchestration. |
| `offers/` | Offer-specific assets and working materials. |
| `execution/` | Deterministic TypeScript runtime (`apis`, `db`, `gtm`, `sync`, `config`, `types`). |
| `sources/` | Pulse framework source catalogs in YAML. |
| `scripts/` | Environment and bootstrap shell scripts. |
| `reference/` | Architecture and supporting references. |

## Quickstart

### Prerequisites

- Node.js `>=22`
- `pnpm`
- Docker Desktop (or compatible Docker daemon)

### Setup

```bash
pnpm install
cp .env.example .env.local
```

Fill required values in `.env.local` (at minimum DB settings are generated/validated by `pnpm start`).

### Bootstrap

```bash
pnpm start
```

This initializes env defaults, starts PostgreSQL, builds TypeScript, and applies/verifies schema.

### Verification Gate

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Pulse Framework Integration

Pulse sync script path:

- Local Pulse file: `~/.pulse/workspaces/business-workspace/sources/sources.yaml`
- Repo catalogs: `sources/*.yaml`
- Sync runtime: `execution/sync/sync-sources.ts`

### Sync Commands

```bash
pnpm sync:sources   # default pull (Pulse -> repo)
pnpm pull:sources   # explicit pull (Pulse -> repo)
pnpm push:sources   # repo -> Pulse
```

`sync:sources` defaults to `pull` when no command argument is provided.

### Merge Behavior

When the same source id exists in both repo and Pulse:

- Repo-curated fields win: `url`, `label`, `kind`, `strategic_role`, `notes`, `status`
- Pulse-managed field wins: `health`

### Strategic Role -> Filename Mapping

| Role | File |
| --- | --- |
| `trust_network` | `trust-network.yaml` |
| `community_forum` | `community-forums.yaml` |
| `review_aggregator` | `review-aggregators.yaml` |
| `industry_signal` | `industry-signals.yaml` |
| `direct_competitor` | `competitors.yaml` |
| `substitute` | `substitutes.yaml` |
| `complementary` | `complementary.yaml` |

### Minimal YAML Example

```yaml
schema_version: "1"
strategic_role: industry_signal
sources:
  - id: src-example
    url: https://example.com
    label: Example Source
    kind: web_page
    strategic_role: industry_signal
    health: unknown
    status: active
    notes: Optional notes field.
```

## Daily Workflow

### Update Repo Catalogs Then Push to Pulse

1. Edit one or more `sources/*.yaml` files.
2. Validate and normalize via:
   `pnpm sync:sources` (optional sanity pull first), then `pnpm push:sources`.
3. Review diffs and commit.

### Pull from Pulse Then Commit Local Snapshot

1. Pull latest source state from Pulse:
   `pnpm pull:sources`.
2. Review resulting `sources/*.yaml` changes.
3. Commit updated catalogs.

## Security and Ops Notes

- Keep secrets in `.env.local`; never commit secret values.
- PostgreSQL bind default is network-reachable: `POSTGRES_BIND_ADDRESS=0.0.0.0`.
- For local-only DB exposure, set `POSTGRES_BIND_ADDRESS=127.0.0.1`.
- Startup output masks DB credentials in connection strings (`***`) and does not print raw password-bearing URIs.

## Pointers

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [reference/architecture.md](./reference/architecture.md)
