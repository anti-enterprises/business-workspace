# Research Queue

Canonical-query files waiting to be picked up by `/hyperresearch`.

## Why this lives at the repo root, not under `research/`

The hyperresearch vault auto-syncs everything under `research/` into a SQLite-backed knowledge graph. Queue files are handoff buffers — canonical queries waiting to be consumed by a research run — and would pollute the vault with untitled "pulse handoff" notes. The vault's documented `exclude_patterns` config only matches on the first path component (subdirectory globs are dead code in the current sync implementation), so the only way to keep the vault clean is to put the queue dir outside `research/` entirely.

## File types

- **`h<NNN>-<slug>.md`** — auto-emitted from Pulse hypotheses by `pnpm research:queue`. One file per Pulse hypothesis matching the weak-but-impactful filter (`state=proposed`, `confidence < 0.6`, non-empty `direction_ids`). Re-running the command is idempotent — files are overwritten, not duplicated.
- **`phase-<N>-<slug>.md`** — hand-curated pilot/setup queries, named for their pipeline stage. These are not auto-rebuildable; treat them as the canonical record of what each pilot was for.
- **Anything else** — manually-seeded queries for ad-hoc deep dives.

## How to use

1. Pick a queued file.
2. Read its `## Canonical query` section — that body is gospel.
3. Invoke `/hyperresearch` and paste the canonical query verbatim.
4. The chain will generate `research/notes/final_report_<vault_tag>.md` (this lands inside the vault — that's the right place for the artifact you DO want indexed).
5. Follow the file's `## Promotion plan` to lift findings into `context/decisions/`, `docs/research-briefs/`, or `sources/*.yaml`.
6. Delete the queue file once the run completes and its promotion plan is resolved.

## Why files, not a queue table?

The queue is intentionally human-readable and editable. Each file is a contract: canonical query + decision context + scope + promotion plan. Reviewers can amend the contract before the run starts; the file is the audit trail for what was asked vs. what was answered.

See `orchestration/skills/hyperresearch_handoff.md` for the full handoff protocol.
