import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { parse } from "yaml";
import { z } from "zod";

// --- Schema ---

export const HypothesisSchema = z.object({
  id: z.string(),
  code: z.string().optional(),
  title: z.string(),
  statement: z.string(),
  state: z.string(),
  confidence: z.number().min(0).max(1),
  age_days: z.number().int().nonnegative().optional(),
  auto_generated: z.boolean().optional(),
  created_at: z.coerce.string(),
  last_updated: z.coerce.string().optional(),
  last_state_change: z.coerce.string().optional(),
  direction_ids: z.array(z.string()).default([]),
  supporting_atom_ids: z.array(z.string()).default([]),
  contradicting_atom_ids: z.array(z.string()).default([]),
  topic_ids: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

// --- Parsing & loading ---

export function parseHypothesis(yamlText: string): Hypothesis {
  const raw = parse(yamlText);
  return HypothesisSchema.parse(raw);
}

export function loadHypothesesDir(dir: string): Hypothesis[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /^H\d+.*\.ya?ml$/i.test(f));
  const result: Hypothesis[] = [];
  for (const f of files) {
    try {
      result.push(parseHypothesis(readFileSync(join(dir, f), "utf-8")));
    } catch (err) {
      console.error(`[pulse-bridge] skipping ${f}: ${(err as Error).message}`);
    }
  }
  return result;
}

// --- Selection ---

export interface SelectOpts {
  /** Maximum confidence to include. Default 0.6. */
  confidenceThreshold?: number;
  /** Require non-empty direction_ids. Default true. */
  requireDirections?: boolean;
  /** States to include. Default ["proposed"]. */
  states?: string[];
}

export function selectWeakHypotheses(
  hypotheses: Hypothesis[],
  opts: SelectOpts = {},
): Hypothesis[] {
  const threshold = opts.confidenceThreshold ?? 0.6;
  const requireDirections = opts.requireDirections ?? true;
  const states = opts.states ?? ["proposed"];
  return hypotheses.filter((h) => {
    if (!states.includes(h.state)) return false;
    if (h.confidence >= threshold) return false;
    if (requireDirections && h.direction_ids.length === 0) return false;
    return true;
  });
}

// --- Query formatting ---

export interface QueuedQuery {
  vaultTag: string;
  filename: string;
  body: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function formatResearchQuery(
  hyp: Hypothesis,
  context?: { decisionContext?: string; scope?: string },
): QueuedQuery {
  const slug = slugify(`${hyp.id} ${hyp.title}`);
  const vaultTag = slug;
  const filename = `${vaultTag}.md`;
  const now = new Date().toISOString();
  const decisionContext =
    context?.decisionContext ??
    `Whether to escalate hypothesis ${hyp.id} to an operating decision. The hypothesis is currently ${hyp.state} at confidence ${hyp.confidence}; a full-tier deep dive is required before any positioning move that depends on it.`;
  const scope =
    context?.scope ??
    `Bounded to the question stated above. Include adversarial perspectives and primary sources cited in the originating Pulse atoms (${hyp.supporting_atom_ids.slice(0, 3).join(", ")}${hyp.supporting_atom_ids.length > 3 ? ", …" : ""}).`;
  const body = `---
hypothesis_id: ${hyp.id}
hypothesis_title: ${JSON.stringify(hyp.title)}
hypothesis_state: ${hyp.state}
hypothesis_confidence: ${hyp.confidence}
direction_ids: [${hyp.direction_ids.join(", ")}]
vault_tag: ${vaultTag}
origin: pulse-bridge
queued_at: ${now}
---

# Pulse handoff — ${hyp.id}: ${hyp.title}

## Canonical query (GOSPEL — paste verbatim into /hyperresearch)

${hyp.statement.trim()}

## Decision context

${decisionContext}

## Scope

${scope}

## Originating hypothesis

- ID: ${hyp.id}
- State: ${hyp.state}
- Confidence: ${hyp.confidence}
- Directions: ${hyp.direction_ids.join(", ") || "(none)"}
- Supporting atoms: ${hyp.supporting_atom_ids.length}
- Contradicting atoms: ${hyp.contradicting_atom_ids.length}
- Pulse file: \`~/.pulse/workspaces/${process.env.PULSE_WORKSPACE_ID ?? "business-workspace"}/hypotheses/${hyp.id}*.yaml\`

After the run completes, write findings back to the hypothesis's \`notes:\` block (or via \`pulse-postmortem\`) with a backlink to the final report at \`research/notes/final_report_${vaultTag}.md\`.
`;
  return { vaultTag, filename, body };
}

// --- Emission ---

export interface WrittenFile {
  path: string;
  vaultTag: string;
}

export function emitQueueFiles(queries: QueuedQuery[], outDir: string): WrittenFile[] {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const written: WrittenFile[] = [];
  for (const q of queries) {
    const path = join(outDir, q.filename);
    writeFileSync(path, q.body, "utf-8");
    written.push({ path, vaultTag: q.vaultTag });
  }
  return written;
}

// --- CLI ---

const isMainModule = process.argv[1]?.endsWith("pulse-bridge.ts") ?? false;

if (isMainModule) {
  const workspaceId = process.env.PULSE_WORKSPACE_ID ?? "business-workspace";
  const hypothesesDir =
    process.env.PULSE_HYPOTHESES_DIR ??
    join(homedir(), ".pulse", "workspaces", workspaceId, "hypotheses");
  const outDir = process.env.RESEARCH_QUEUE_DIR ?? join(process.cwd(), "queue");

  const threshold = process.env.CONFIDENCE_THRESHOLD
    ? Number(process.env.CONFIDENCE_THRESHOLD)
    : undefined;
  const requireDirections = process.env.REQUIRE_DIRECTIONS !== "false";
  const dryRun = process.argv.includes("--dry-run");

  console.error(`[pulse-bridge] reading hypotheses from ${hypothesesDir}`);
  const all = loadHypothesesDir(hypothesesDir);
  console.error(`[pulse-bridge] loaded ${all.length} hypotheses`);

  const weak = selectWeakHypotheses(all, {
    confidenceThreshold: threshold,
    requireDirections,
  });
  console.error(`[pulse-bridge] ${weak.length} match weak-but-impactful filter`);

  const queries = weak.map((h) => formatResearchQuery(h));

  if (dryRun) {
    for (const q of queries) {
      console.log(`would write: ${join(outDir, q.filename)} (${basename(q.filename)})`);
    }
    process.exit(0);
  }

  const written = emitQueueFiles(queries, outDir);
  for (const w of written) {
    console.log(w.path);
  }
  console.error(`[pulse-bridge] wrote ${written.length} files to ${outDir}`);
}
