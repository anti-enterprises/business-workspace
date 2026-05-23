# business-workspace

Business workspace with deterministic TypeScript execution.

## Mental Model

`Intent + Knowledge -> Reasoning -> Action`

- `directives/` = intent
- `orchestration/` + `context/` = reasoning and knowledge
- `execution/` = deterministic actions/tools

To execute any directive, follow `orchestration/routing.md` — that document is the routing protocol. Directives never call execution directly; orchestration selects a workflow and chains execution tools. There is no 1:1 mapping between a directive and a workflow.

Pulse intelligence (atoms, hypotheses, briefs, identity/customer/offer/goals/position) lives outside this repo at `~/.pulse/workspaces/business-workspace/`. The repo's `sources/` is the only push boundary into Pulse (`pnpm push:sources`); `context/` is local operating knowledge, not a Pulse source of truth.

## Commands

```bash
pnpm dev          # Watch mode (execution/index.ts)
pnpm build        # Compile TypeScript and copy schema
pnpm start        # Bootstrap local environment + DB + schema checks
pnpm test         # Run tests
pnpm typecheck    # Type check
pnpm db:setup     # Apply/validate schema
pnpm sync:sources # Pulse source synchronization
```

## Project Structure

```text
directives/
orchestration/
  agents/
  apps/
  workflows/
  skills/
  triggers/
context/
offers/
execution/
  apis/
  db/
  gtm/
  sync/
  config/
  types/
sources/
scripts/
reference/
```

## Rules for Agents

1. Secrets belong in `.env.local` and must never be committed.
2. `sources/` is Pulse-owned catalog data; keep schema-compatible YAML only.
3. Keep `scripts/` for bootstrap/infra shell logic, not business runtime logic.
4. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before completion.

<!-- hyperresearch:start -->
## Research Base (hyperresearch) — Today is 2026-05-14

**CLI path: `hyperresearch`** — use this exact path for every hyperresearch command. It may not be on your system PATH.

**Paths in this document are relative to your current working directory**, not to the CLI binary's location. Use `research/notes/final_report_<vault_tag>.md` (not a prefix with the binary path) when you save files.

This project uses hyperresearch as an agent-driven research knowledge base. The `research/` directory contains markdown notes collected from web sources and original research. Append `--json` to any command for structured output.

### How to do research

**Run a research session with `/hyperresearch <query>`.** This invokes the V8 16-step pipeline. The entry skill at `.claude/skills/hyperresearch/SKILL.md` is a thin ROUTER. The 16 step procedures live in their own skills (`hyperresearch-1-decompose` through `hyperresearch-16-readability-audit`) and are loaded fresh into context via the `Skill` tool when each step runs. This solves V7's context-compaction problem: each step's procedure lands in context only when needed. Read the entry skill before you start a research session; it explains the chain mechanics.

Step 1 classifies the query into one of two tiers (`light` or `full`) and the rest of the pipeline scales accordingly — short bounded queries skip the depth investigations, critics, and patcher (~30-40 min); argumentative deep-research queries run all 16 steps with adversarial review (~1.5-2.5 hours).

**Do NOT use WebFetch for source pages** — use `hyperresearch fetch` instead. The skill files explain when to fetch vs. search.

### What the skill files own

The skill files own everything about how to research. That includes:
- The pipeline phases and what each phase does
- Which subagents exist and what each one is for (fetcher, loci-analyst, depth-investigator, 4 critics, patcher, polish-auditor)
- The tool-lock invariant (patcher and polish-auditor can only Read + Edit, never Write)
- The subagent spawn contract (every Task call passes the verbatim research_query + pipeline position + inputs)
- Artifact locations (`research/scaffold.md`, `research/prompt-decomposition.json`, `research/loci.json`, `research/comparisons.md`, interim notes, patch / polish logs)
- The curation pass after every research session

If you need to know how hyperresearch works, read the skill file. This document does NOT duplicate that content — when the skill file and this file disagree, the skill file wins.

### Canonical research query

In a normal run, the canonical research query is the user's verbatim prompt. In wrapped runs, if `research/prompt.txt` exists, that file is gospel and overrides any wrapping instructions. The pipeline persists the query as `research/query-<vault_tag>.md` with YAML frontmatter — this is the canonical query reference for all downstream layers. Wrapper requirements (save path, citation format, terminal sections) are a separate contract, captured in the scaffold — not pasted into the `## User Prompt (VERBATIM — gospel)` section.

### Academic APIs before web search

For any topic with a research literature, hit academic APIs BEFORE running web searches. They return citation-ranked canonical papers; web search returns derivative commentary.

- **Semantic Scholar:** `https://api.semanticscholar.org/graph/v1/paper/search?query=<q>&fields=title,year,citationCount,externalIds&limit=10` — then citation-chain the top papers forward + backward.
- **arXiv:** `https://export.arxiv.org/api/query?search_query=cat:cs.LG+AND+all:<q>&sortBy=relevance&max_results=25`
- **OpenAlex:** `https://api.openalex.org/works?search=<q>&sort=cited_by_count:desc&per-page=15&mailto=research@example.com`
- **PubMed:** `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=<q>&retmode=json&retmax=20`

After the academic sweep, run web searches for context, news, non-academic angles, and at least one adversarial search ("criticism of X", "limitations of X").

### PDFs fetch directly

`hyperresearch fetch` auto-detects PDF URLs (arXiv, NBER, SSRN, direct `.pdf` links) and extracts full text via pymupdf. Fetch them aggressively. Raw PDFs land in `research/raw/<note-id>.pdf` and the note's frontmatter links back via `raw_file:`.

### Searching the vault

```bash
hyperresearch search "query" --json                # Full-text search
hyperresearch search "query" --tag ml --json       # Filter by tag / status / date / parent
hyperresearch search "query" --include-body --json # Full-body search, not just titles
hyperresearch note show <id> --json                # Read one note
hyperresearch note show <id1> <id2> <id3> --json   # Batch-read notes in one call
hyperresearch note list --json                     # List all notes with summaries
hyperresearch tags --json                          # Existing tag vocabulary
```

### Images, screenshots, and assets

```bash
hyperresearch fetch "<url>" --tag <topic> --save-assets -j   # Saves screenshot + top images
hyperresearch assets list --note <note-id> --json            # Assets for a specific note
hyperresearch assets path <note-id> --type screenshot -j     # Get screenshot path (viewable with Read)
```

### Authenticated crawling

Login-gated content (LinkedIn, Twitter, paywalled news) needs a browser profile. Set up once via `hyperresearch setup` or `crwl profiles`. Config in `.hyperresearch/config.toml` under `[web]`: `profile = "research"`, `magic = true`. LinkedIn / Twitter / Facebook / Instagram / TikTok auto-use a visible browser to avoid session kills.

If a fetch returns a login wall, tell the user to run `hyperresearch setup` and create a login profile.

### Curate after every session

Every research session must end with a curation pass:

```bash
hyperresearch note list --status draft -j                                        # Find unprocessed notes
hyperresearch note show <id> -j                                                  # Read the content
hyperresearch note update <id> --summary "<specific summary>" --add-tag <t> -j   # Add summary + tags
hyperresearch lint -j                                                            # Find missing tags / summaries / broken links
hyperresearch repair -j                                                          # Auto-fix broken links, rebuild indexes
hyperresearch status -j                                                          # Overall vault health
```

Lifecycle: `draft` → `review` → `evergreen` (or `stale` → `deprecated` → `archive` for outdated material).

Summaries must be specific — "Mamba achieves linear-time sequence modeling via selective state spaces" beats "Paper about Mamba". Reuse the existing tag vocabulary (`hyperresearch tags -j`) rather than inventing new tags.

### Key conventions

- Notes live in `research/notes/` as markdown with YAML frontmatter
- Link notes with `[[note-id]]` syntax
- After editing `.md` files directly, run `hyperresearch sync` to update the index
- Run `hyperresearch --help` for the full command list
<!-- hyperresearch:end -->

## Workspace ↔ Hyperresearch Integration

The section above (between `hyperresearch:start` / `hyperresearch:end`) is managed by `hyperresearch install` and will be overwritten on reinstall. The integration rules below are this workspace's contract on top of that — keep them outside the managed block.

Hyperresearch is the workspace's **deep-dive subsystem**. Pulse (at `~/.pulse/workspaces/business-workspace/`) is the **continuous-monitoring** engine. Different jobs — don't conflate them. See the proposal split in `orchestration/skills/hyperresearch_handoff.md`.

### Three integration vectors

1. **Directive contract.** `directives/research_briefs.md` declares the intent shape for deep dives. The only execution path is `/hyperresearch`.
2. **Pulse → Hyperresearch handoff.** Run `pnpm research:queue` to emit canonical-query files into `queue/` for Pulse hypotheses with thin evidence (`state=proposed`, `confidence < 0.6`, non-empty `direction_ids`). Each queued file holds the canonical query + scope + decision context; paste the body into `/hyperresearch`.
3. **Hyperresearch → Workspace promotion.** Every full-tier report ends with `## Promotion candidates`. Resolve each before declaring the run done:
   - `context/decisions/<topic>.md` — operating decisions (one-page, backlinked to vault).
   - `docs/research-briefs/<vault_tag>.md` — shareable snapshot copies.
   - `sources/*.yaml` + `pnpm push:sources` — the only sanctioned push path into Pulse.

### Enforced rules

Operating rules 16–18 in `context/operating_rules.md` carry the binding contract: no `WebFetch`, no positioning escalation of thin hypotheses without a deep-dive, no direct writes into the Pulse workspace from a research run.
