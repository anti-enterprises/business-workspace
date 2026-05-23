# Research Briefs Directive

## Intent
Produce an evidence-backed brief on a bounded question to inform a stated decision. The brief must be source-grade (every load-bearing claim cites a primary source held in the research vault) and tier-appropriate (light for fast bounded recaps; full for argumentative deep dives requiring adversarial review).

## Inputs
- **Canonical query** — the verbatim question the brief must answer. Gospel for the entire pipeline.
- **Scope** — what is in and out (time horizon, geography, comparable set).
- **Decision context** — the choice the brief will inform (e.g., "should we lead with security in the MSP retainer pitch?"). Drives modality classification.
- **Tier hint (optional)** — `light` or `full`. If absent, the pipeline classifies automatically.
- **Source seeds (optional)** — URLs the requester already knows are relevant.

## Output
- **Final report:** `research/notes/final_report_<vault_tag>.md` (vault-resident, citable, lintable).
- **TL;DR:** first section of the report — three to five sentences that answer the query.
- **Source list:** end of the report — every primary source with vault note ID.
- **Promotion candidates:** explicit recommendations at the end of the report for what to lift into:
  - `context/decisions/<topic>.md` — operating decisions the brief justifies
  - `docs/research-briefs/<vault_tag>.md` — shareable external version of the report
  - `sources/*.yaml` — URLs worth adding to Pulse's monitored set

## Workflow
The only execution path for this directive is the `/hyperresearch` chain — see `orchestration/skills/hyperresearch_handoff.md` for tier selection, promotion rules, and Pulse handoff guidance. The directive does not call execution directly; the orchestration skill does.

## Failure modes
- **Empty vault on a topic with no primary sources reachable.** Surface the gap; do not fabricate citations. Re-scope to a narrower question if needed.
- **Tier mismatch.** A 2-hour full-tier run on a 30-minute light-tier question wastes capacity; the reverse produces shallow output. Trust the step 1 classifier unless the requester has explicit knowledge it is wrong.
- **Decision drift.** If the brief's conclusion would change the requester's question, escalate before promoting — do not silently rewrite the decision context.
