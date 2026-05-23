# Operating Rules

Runtime guardrails for orchestration and execution. These rules are consumed by every workflow; if a rule and a directive conflict, the rule wins (or the directive is rejected as out of policy).

## Data integrity

1. **Postgres is the deterministic state store.** Campaign, contact, message, signal-routing state lives in `execution/db/`. Workflows must not keep durable state in memory or in flat files outside the DB.
2. **Sources are append-or-update; never silent-delete.** Removing a source from `sources/*.yaml` should be done via an explicit edit, then synced. Pulse `archived` status is preferred over deletion for sources with historical atoms.
3. **Pulse `workspace.yaml` is read-mostly from this repo.** Reads are fine; writes happen through `pulse` commands (or with backup + manual edit), never from execution code.
4. **No secrets in repo state.** Environment values come from `.env.local` (uncommitted). Anything that ends up in the DB or in catalogs must be free of credentials.

## Reliability

5. **Workflows fail loud, not quietly.** A missing input, missing context, or unknown source is a stop condition — not a default-substitution.
6. **External API calls go through `execution/apis/base-client.ts`.** That client owns retry, rate-limit, and tool-usage logging. Direct `fetch` from a workflow is a smell.
7. **Idempotency for any DB write that can be retried.** Use natural keys (e.g., source id, contact email) and `ON CONFLICT` clauses. The schema test suite enforces idempotency for upsert paths.
8. **Tool-usage and signal-routing decisions are audited.** Use `logToolUsage` / `logSignalRoutingAudit` for any non-trivial third-party call or routing decision.

## Cost and cadence

9. **Daily limits per API live in `execution/types/api.ts` (`DAILY_LIMITS`).** Workflows must check before consuming.
10. **Pulse cadences are weekly / monthly / quarterly.** Operational workflows do not call `pulse weekly` etc. inline; they consume the briefs Pulse has already produced.

## Voice and outbound

11. **Brand voice (`context/brand_voice.md`) governs all outbound copy.** A workflow that drafts messages must load it and pass it as a constraint.
12. **Outbound messages are recorded in `execution/db/messages.ts` before send.** Status transitions are tracked end-to-end (queued → sent → replied / bounced).

## Failure feedback

13. **A failure that reflects an intent gap belongs in the directive.** Update `directives/<name>.md` to clarify the contract.
14. **A failure that reflects a missing tool belongs in `execution/`.** Build the tool, add a test, then re-route.
15. **A failure that reflects a missing rule belongs here.** Add the rule and reference it from the workflow that hit the failure.

## Research

16. **Web fetches go through `hyperresearch fetch`, never `WebFetch`.** The hyperresearch CLI runs a real headless browser, saves the full content + screenshot, and indexes the page into the vault so the next session inherits it. `WebFetch` produces nothing reusable and bypasses the vault hook. The only sanctioned exceptions are API calls through `execution/apis/base-client.ts` for structured data sources.
17. **Pulse hypotheses with thin evidence trigger a hyperresearch deep dive before they escalate to a positioning decision.** Thin = `state=proposed` AND `confidence < 0.6` AND non-empty `direction_ids`. Run via the `research_briefs` directive (`orchestration/skills/hyperresearch_handoff.md`). Promoting a thin hypothesis into `context/decisions/` without a deep-dive backing is a rule violation.
18. **Hyperresearch source discoveries enter Pulse only via `sources/*.yaml` + `pnpm push:sources`.** Never write to `~/.pulse/workspaces/<id>/sources/` directly from a research run. Never write atoms, hypotheses, or briefs into the Pulse workspace from `execution/` — Pulse owns its writes. The repo's `sources/` catalog is the only push boundary.
