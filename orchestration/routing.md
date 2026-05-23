# Orchestration Routing

The orchestration layer is the bridge between human-readable intent (`directives/`) and deterministic action (`execution/`). It does not contain business logic of its own — it interprets a directive, gathers the knowledge needed to act on it, and chains execution tools to produce the directive's stated output.

## Generic Flow

```
directive  →  context lookup  →  workflow selection  →  execution tool chain  →  outcome write-back
```

There is no 1:1 mapping between a directive and a workflow. A directive declares **intent + inputs + output**; orchestration decides **which workflow + which tools + in what order** at run time, based on the directive's inputs and the workspace's current context.

## Layer responsibilities

| Layer | Owns | Does not own |
| --- | --- | --- |
| `directives/` | Intent, required inputs, expected output | How the work is done |
| `orchestration/` | Routing rules, workflows, agent/app/skill/trigger coordination | Business knowledge, side effects |
| `context/` | Operational knowledge consumed at run time (rules, voice, profile snapshots) | Pulse intelligence (lives in `~/.pulse/`) |
| `execution/` | Deterministic side effects (DB writes, API calls, source sync) | Routing decisions, intent |

## Resolving a directive

1. **Read the directive** for intent, inputs, output.
2. **Resolve inputs** against `context/` (operating rules, brand voice, business profile, offer/customer snapshots) and, where needed, against Pulse outputs (briefs, atoms, hypotheses) read from the workspace at `~/.pulse/workspaces/<id>/`.
3. **Select a workflow** under `orchestration/workflows/` whose contract matches the directive's inputs and output. If none fits, the directive is not yet executable — record the gap, do not invent a workflow inline.
4. **Chain execution tools** from `execution/` (apis, db, gtm, sync). Prefer existing tools; only add new ones in `execution/` when no composition of existing tools satisfies the workflow.
5. **Write outcomes back** through `execution/db/` (deterministic state) and, where the outcome should inform Pulse (e.g., a new source discovered during outreach), through `execution/sync/` to push updates into the Pulse workspace.

## Data-flow rules

- **Sources are the only push boundary into Pulse.** Adds/edits in `sources/*.yaml` are pushed to `~/.pulse/workspaces/<id>/sources/` via `pnpm push:sources`. Never write directly to the Pulse workspace from execution.
- **Context is not a Pulse source of truth.** Files in `context/` describe how this workspace operates (rules, voice, snapshots). Pulse's source of truth is `~/.pulse/workspaces/<id>/workspace.yaml`. Where the two need to agree, treat Pulse as authoritative for `identity / customer / offer / goals / position`, and refresh context snapshots from Pulse — not the other way around.
- **Directives never call execution directly.** They are intent declarations. Execution is reached only through a workflow.
- **Workflows are stateless on the directive level.** State that survives a run lives in `execution/db/` or in the Pulse workspace.

## Operational defaults

- Prefer existing deterministic tools before creating new ones.
- Keep workflow state explicit; never let workflows depend on hidden global state.
- Treat failures as routing feedback — record the failure mode in `context/` (operating rules) or in the relevant directive when it reflects an intent gap, not just a code bug.
- A workflow that needs business knowledge it cannot find should fail fast and surface the missing context, rather than guess.
