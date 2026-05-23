/**
 * UpWork extractor — Gmail-backed.
 *
 * Targets job-post-pattern analysis. The SKILL runner (Claude) executes
 * the query against Gmail MCP search_threads and parses each matching
 * email's body for job titles, descriptions, budgets, client locations,
 * and posting time. Out of scope: client messages from
 * room_*@email.upwork.com, "Invitation to Apply" emails, billing.
 *
 * In-scope sources:
 *  - donotreply@upwork.com, subject "Jobs posted in the last 24 hours"
 *    (daily digests — 5-10+ jobs per email)
 *  - donotreply@upwork.com, subject starting "New Job"
 *    (single-job real-time alerts when fired)
 *
 * The extractor process itself has no Gmail token; this module is the
 * source-discovery + query-builder bridge between sources.yaml and the
 * Gmail MCP pass.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { RepoSourceFile } from "../types/source.js";
import { buildUpworkQuery, GMAIL_LABELS, type GmailSource } from "./extract-gmail.js";

const REPO_SOURCES_DIR = join(process.cwd(), "sources");

export interface UpworkSource {
  id: string;
  label: string;
  url: string;
  strategic_role: string;
  tags?: string[];
  notes?: string;
}

export interface UpworkExtractionPlan {
  sources: UpworkSource[];
  gmailLabel: string;
  query: string;
}

/**
 * Load all active UpWork sources. We treat any source with a URL that
 * matches upwork.com AND status: active as Gmail-label-backed (the
 * UpWork web site itself has no public API).
 */
export function loadUpworkSources(): UpworkSource[] {
  if (!existsSync(REPO_SOURCES_DIR)) return [];
  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));
  const sources: UpworkSource[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    for (const source of parsed.sources) {
      if (source.status !== "active") continue;
      if (!source.url || !/upwork\.com/i.test(source.url)) continue;

      sources.push({
        id: source.id,
        label: source.label,
        url: source.url,
        strategic_role: source.strategic_role,
        tags: source.tags,
        notes: source.notes,
      });
    }
  }

  return sources;
}

/**
 * Cast UpworkSource into the GmailSource shape so downstream code that
 * already consumes the newsletter pattern can reuse the same plumbing.
 */
export function upworkSourceToGmailSource(s: UpworkSource): GmailSource {
  return {
    id: s.id,
    label: s.label,
    sender: null, // UpWork emails arrive from several addresses; rely on label
    gmailLabel: GMAIL_LABELS.upwork,
    strategic_role: s.strategic_role,
    tags: s.tags,
    notes: s.notes,
  };
}

/**
 * Build the full extraction plan for the daily/weekly UpWork pass.
 * Returns the list of UpWork sources, the Gmail label, and the search
 * query the SKILL runner (Claude) executes via Gmail MCP search_threads.
 */
export function planUpworkExtraction(newerThan = "1d"): UpworkExtractionPlan {
  const sources = loadUpworkSources();
  return {
    sources,
    gmailLabel: GMAIL_LABELS.upwork,
    query: buildUpworkQuery(newerThan),
  };
}

// --- CLI entrypoint ---

if (
  process.argv[1]?.endsWith("extract-upwork.ts") ||
  process.argv[1]?.endsWith("extract-upwork.js")
) {
  const newerThan = process.argv[2] ?? "1d";
  const plan = planUpworkExtraction(newerThan);
  console.log("UpWork sources active:", plan.sources.length);
  for (const s of plan.sources) console.log(`  - ${s.id} (${s.url})`);
  console.log("Gmail label:", plan.gmailLabel);
  console.log("Gmail search query:", plan.query);
  console.log(
    "\nNote: Gmail extraction is performed by the SKILL runner via the Gmail MCP " +
      "search_threads tool with the query above. This script only prepares the plan.",
  );
}
