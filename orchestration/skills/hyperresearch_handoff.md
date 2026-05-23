# Hyperresearch Handoff

Orchestration skill for the `research_briefs` directive and for Pulse-triggered deep dives. Owns the contract between Pulse's continuous-monitoring loop, ad-hoc deep dives, and the workspace's promotion paths (`context/decisions/`, `docs/research-briefs/`, `sources/*.yaml`).

## When to invoke `/hyperresearch`

Reach for the chain when the question is **argumentative, bounded, and decision-relevant**.

| Signal | Action |
|---|---|
| Pulse hypothesis with `state=proposed` AND `confidence < 0.6` AND non-empty `direction_ids` | Run **full** tier on the hypothesis statement |
| Orphan Pulse atom cluster with no hypothesis fit, but high impact-per-source | Run **full** tier on the cluster's emergent question |
| Ad-hoc bounded recap (e.g., "MCP vs A2A in 30 min") | Run **light** tier on the user's verbatim query |
| Strategic pivot or repositioning under consideration | Run **full** tier with `decision context` set to the pivot |
| Competitor profile or substitution audit beyond daily source-catalog monitoring | Run **full** tier scoped to the competitor |

Do NOT invoke for:
- Daily/weekly operational monitoring (that's Pulse).
- Pricing or factual lookups with one canonical source (use `hyperresearch fetch` directly, not the full chain).
- Internal-data questions (CRM, leads, DB state — those go through `execution/`).

## How to invoke

1. Confirm canonical query is captured verbatim (gospel).
2. Capture scope and decision context in scaffold.
3. Enter the chain: `Skill(skill: "hyperresearch")`. The entry skill is a router — it bootstraps the vault, classifies tier, and sequences all 16 step skills. Do not invoke step skills directly.

For Pulse-triggered runs, the queued query files live at `queue/*.md` (emitted by `pnpm research:queue`). Each queued file already includes the canonical query, scope, decision context, and originating hypothesis ID — paste its body into the `/hyperresearch` invocation.

## Tier discipline

Step 1 classifies tier automatically. Override only when:
- **Tier up to full** when the requester has explicit decision authority and the brief informs a strategic position (positioning, pricing, ICP change).
- **Tier down to light** never. If step 1 says full, the question is argumentative — light tier will produce a shallow answer.

Light tier: ~30–40 min, ~$5–15. Full tier: ~1.5–2.5 hours, ~$60–120. Budget accordingly.

## After the run: promotion paths

Every full-tier report ends with a `## Promotion candidates` section. Resolve each candidate before declaring the run done.

### To `context/decisions/<topic>.md`
Use when the brief justifies an **operating decision** (a thing the workspace will now do, stop doing, or weigh differently). The decision file is short — one page — and backlinks to the vault report for evidence. Example: "Adopt vendor X for retrieval, deprecate vendor Y (per `final_report_retrieval-vendor-2026.md`)."

### To `docs/research-briefs/<vault_tag>.md`
Use when the report is **reference material worth sharing externally** (with clients, on a landing page, in onboarding). Copy the report into `docs/research-briefs/`, strip any private scaffolding, keep the source list. The vault report remains the canonical version; the docs copy is a snapshot.

### To `sources/*.yaml`
Use when a fetched URL is a **publication, primary-source author, or analyst feed** worth Pulse monitoring going forward. Add it to the matching catalog (`blogs-*.yaml`, `newsletters.yaml`, `industry-signals.yaml`, etc.), then `pnpm push:sources`. This is the **only** sanctioned path into Pulse from a research run.

### To Pulse atoms (indirect)
Hyperresearch does not write Pulse atoms directly. To convert report findings into atoms, point `pulse-extract` at the report URL (or at the promoted `docs/research-briefs/` copy) during the next Pulse cadence run.

## Curation checklist (run after every chain completion)

1. `hyperresearch lint -j` — surface missing summaries, broken links, untagged notes.
2. `hyperresearch note update <id> --summary "<specific>"` on every draft-status note created by the run.
3. Promote evergreen notes: `--status evergreen` once the report ships.
4. Resolve all promotion candidates listed in the report.
5. Mark the originating Pulse hypothesis (if any) with a note: `pulse-postmortem` or hypothesis `notes:` block referencing the report.

## Anti-patterns

- **Bypassing tier gates.** "Just run full to be safe" wastes capacity. Trust the classifier.
- **Promoting whole reports into `context/`.** `context/` stays lean — backlinks, not body text.
- **Writing to Pulse atoms directly from a research run.** The only push path is `sources/*.yaml`.
- **Using `WebFetch`.** The hook nudges against it; the rule in `context/operating_rules.md` enforces it. Use `hyperresearch fetch`.
- **Running `/hyperresearch` for a question Pulse already answered.** Check `~/.pulse/workspaces/business-workspace/briefs/` first.
