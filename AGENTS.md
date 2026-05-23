# Repository Guidelines

## Architecture Model

This repo is a business workspace, not a fullstack app.

Pipeline model:

`Directives (intent) -> Orchestration + Context (reasoning/knowledge) -> Execution (deterministic tools)`

The routing protocol — how a directive flows through orchestration and into execution — lives in `orchestration/routing.md`. Read it before executing any directive. There is no 1:1 mapping between a directive and a workflow; orchestration chooses both the workflow and the execution tool chain at run time.

Pulse intelligence is external (`~/.pulse/workspaces/business-workspace/`). The `sources/` directory is the push boundary into Pulse; `context/` is local operating knowledge, not a Pulse source of truth. See `reference/architecture.md` for the full data-flow map.

## Project Structure
```text
directives/           # Human-readable intent and SOPs
orchestration/        # Routing, workflows, agent/app/skill/trigger coordination
context/              # Business/system knowledge used during orchestration
offers/               # Offer-specific working assets
execution/            # Deterministic TypeScript runtime (apis/db/gtm/sync/config/types)
sources/              # Pulse source catalogs (YAML)
scripts/              # Environment/bootstrap shell scripts only
reference/            # Architecture and supporting references
```

## Build, Test, and Development Commands
- `pnpm install` sets up dependencies.
- `pnpm dev` starts watch mode via `execution/index.ts`.
- `pnpm build` compiles TypeScript and copies DB schema.
- `pnpm test` runs Vitest.
- `pnpm typecheck` runs TypeScript checking.
- `pnpm db:setup` validates/applies schema from `execution/db/schema.sql`.
- `pnpm sync:sources` syncs repo `sources/` with Pulse workspace sources.

## Coding Style & Naming Conventions
- TypeScript is the deterministic runtime language (strict mode).
- 2-space indentation, double quotes.
- Functions and variables use camelCase.
- Utility files use kebab-case.

## Testing Guidelines
- Test framework: Vitest.
- Test files: `*.test.ts` under `execution/**/__tests__/`.
- Keep tests focused on behavioral changes and regression risk.
- Run the full verification gate before claiming completion.

## Configuration & Secrets
- Environment files live in `.env.local` (never committed).
- Never commit secrets.
- Document new environment variables in `.env.example`.
- DB external exposure is configurable via `POSTGRES_BIND_ADDRESS`:
  - default: `0.0.0.0` (network-reachable)
  - safer local-only option: `127.0.0.1`

## Verification Before Completion

Run this full check before claiming done:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

If any step cannot run, explicitly report what was skipped and why.
