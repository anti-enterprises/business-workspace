// Rewrite atoms.jsonl entries for today's run into the canonical schema.
// Canonical fields: id, workspace_id, source_kind, source_adapter, source_label,
// source_ref, source_url, type, content, entities, direction_ids, hypothesis_ids,
// factor_ids, observed_at, extracted_at.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parse } from "yaml";

const WORKSPACE_ID = process.env.PULSE_WORKSPACE_ID ?? "business-workspace";
const WS = join(homedir(), ".pulse/workspaces", WORKSPACE_ID);
const ATOMS = `${WS}/atoms/2026-05/atoms.jsonl`;
const SOURCES_PATH = `${WS}/sources/sources.yaml`;
const OBSERVED_AT = "2026-05-20T13:00:00Z";

const sourcesRaw = parse(readFileSync(SOURCES_PATH, "utf-8"));
const labelById = new Map();
const urlById = new Map();
for (const s of sourcesRaw.sources) {
  labelById.set(s.id, s.label || s.id);
  urlById.set(s.id, s.url || null);
}

// Backup atoms.jsonl
copyFileSync(ATOMS, `${ATOMS}.pre-fix-2026-05-20.bak`);

const lines = readFileSync(ATOMS, "utf-8").split("\n").filter(Boolean);
const out = [];
let rewritten = 0;
for (const line of lines) {
  const a = JSON.parse(line);
  if (a.id && a.id.startsWith("atom-2026-05-20-") && !a.content) {
    // canonicalize
    const canonical = {
      id: a.id,
      workspace_id: WORKSPACE_ID,
      source_kind: a.source_kind || "extraction",
      source_adapter: a.source_adapter || "extraction",
      source_label: labelById.get(a.source_ref) || a.source_ref,
      source_ref: a.source_ref,
      source_url: a.raw_source_url || urlById.get(a.source_ref) || null,
      type: a.type,
      content: a.text || a.content,
      entities: a.entities || [],
      direction_ids: a.direction_ids || [],
      hypothesis_ids: a.hypothesis_ids || [],
      factor_ids: a.factor_ids || [],
      topic_ids: a.topic_ids || [],
      observed_at: OBSERVED_AT,
      extracted_at: a.captured_at || OBSERVED_AT,
      window: a.window || "last_24h",
    };
    out.push(JSON.stringify(canonical));
    rewritten++;
  } else {
    out.push(line);
  }
}
writeFileSync(ATOMS, out.join("\n") + "\n");
console.log({ totalLines: lines.length, rewritten });
