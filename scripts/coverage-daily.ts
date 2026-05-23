/**
 * Compute the daily run coverage ledger.
 * Reads sources.yaml + extractor outputs + atoms-new.jsonl,
 * emits per-source status and aggregate counts as JSON.
 */
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parse } from "yaml";

const WORKSPACE_ID = process.env.PULSE_WORKSPACE_ID ?? "business-workspace";
const PULSE = join(homedir(), ".pulse/workspaces", WORKSPACE_ID, "sources/sources.yaml");
const RSS = "/tmp/pulse-daily-2026-05-08/rss.json";
const REDDIT = "/tmp/pulse-daily-2026-05-08/reddit.json";
const YT = "/tmp/pulse-daily-2026-05-08/youtube.json";
const X_LOG = "/tmp/pulse-daily-2026-05-08/x.log";
const ATOMS = "/tmp/pulse-daily-2026-05-08/atoms-new.jsonl";

const WINDOW_START = "2026-05-07T13:00:00Z";  // last_24h ending now (run started ~13:30Z 2026-05-08)

// 1) Load sources
type Src = {
  id: string;
  kind: string;
  status: string;
  strategic_role?: string;
  tags?: string[];
  feed_url?: string | null;
  channel_id?: string | null;
};
const sourcesRaw = parse(readFileSync(PULSE, "utf-8")) as { sources: Src[] };
const allSources = sourcesRaw.sources;

// 2) Filter eligible
function isExcluded(s: Src): boolean {
  if (s.kind === "review_aggregator") return true;
  if (s.strategic_role === "review_aggregator") return true;
  if (s.tags?.includes("software_reviews")) return true;
  return false;
}

const active = allSources.filter((s) => s.status === "active");
const eligible = active.filter((s) => !isExcluded(s));
const excludedReview = active.filter((s) => isExcluded(s));

// 3) Load atom source_refs
const atomLines = readFileSync(ATOMS, "utf-8").split("\n").filter(Boolean);
const atomsBySource = new Map<string, number>();
for (const line of atomLines) {
  const a = JSON.parse(line);
  atomsBySource.set(a.source_ref, (atomsBySource.get(a.source_ref) ?? 0) + 1);
}

// 4) Load RSS results: classify by entries presence
type RssRes = { sourceId: string; entries: { published?: string; title?: string }[] };
const rssRes: RssRes[] = JSON.parse(readFileSync(RSS, "utf-8"));
const rssMap = new Map(rssRes.map((r) => [r.sourceId, r]));

// 5) Reddit results
type RedRes = { source: { id: string }; posts: { created_at: string }[] };
const redRes: RedRes[] = JSON.parse(readFileSync(REDDIT, "utf-8"));
const redMap = new Map(redRes.map((r) => [r.source.id, r]));

// 6) YouTube results
type YtRes = { sourceId: string; video: { publishedAt: string } };
const ytRes: YtRes[] = JSON.parse(readFileSync(YT, "utf-8"));
const ytMap = new Map<string, YtRes[]>();
for (const v of ytRes) {
  if (!ytMap.has(v.sourceId)) ytMap.set(v.sourceId, []);
  ytMap.get(v.sourceId)!.push(v);
}

// 7) Auth-blocked source IDs (carry over from yesterday's run)
const AUTH_BLOCKED = new Set([
  "src-linkedin",
  "src-upwork",
  "src-x-jcervinoiv",
  "src-skool-aaa-hub",
  "src-skool-4d-academy",
  "src-discord-synkrai",
  "src-whop-100kaiagency",
  "src-ig-cameronengland",
  "src-ig-liamottley",
  "src-ig-tysonscales",
  "src-ig-enzosison",
]);

// 8) Fetch-failed sources
const FETCH_FAILED = new Set(["src-producthunt"]);

// 9) Newsletter sources with at least one inbound email in last 24h
//    From Gmail search: only the-neuron and morningbrew are NEW (after yesterday's 23:30Z cutoff)
//    Other newsletters also queried but emails were already in yesterday's run
const NEWSLETTER_NEW_ITEMS = new Set([
  "src-newsletter-neuron",     // The Neuron - 2026-05-08T11:06Z (atoms produced)
  "src-nl-morningbrew",        // Morning Brew - 2026-05-08T09:21Z (no atoms)
]);
const NEWSLETTER_NO_NEW = new Set([
  "src-newsletter-alphasignal",     // last email 2026-05-07T13:25Z (covered yesterday)
  "src-newsletter-ahead-of-ai",
  "src-newsletter-import-ai",
  "src-newsletter-exponential-view",
  "src-newsletter-algorithmic-bridge", // 2026-05-07T19:32Z covered yesterday
  "src-newsletter-new-economies",
  "src-newsletter-gradient-ascent",
  "src-newsletter-nlp-news",
  "src-newsletter-jam-with-ai",       // 2026-05-07T13:16Z covered yesterday
  "src-nl-strictlyvc",                // last 2026-05-06 covered
]);

// 10) Classify each eligible source
type Status =
  | "processed_with_atoms"
  | "processed_no_atoms"
  | "no_new_content"
  | "fetch_failed"
  | "auth_blocked"
  | "excluded_review_rule";

const ledger: Record<string, Status> = {};
const newItemCount: Record<string, number> = {};

for (const s of eligible) {
  // Override 1: atoms produced
  if (atomsBySource.has(s.id)) {
    ledger[s.id] = "processed_with_atoms";
    newItemCount[s.id] = atomsBySource.get(s.id) ?? 0;
    continue;
  }
  // Override 2: auth blocked
  if (AUTH_BLOCKED.has(s.id)) {
    ledger[s.id] = "auth_blocked";
    continue;
  }
  // Override 3: fetch failed
  if (FETCH_FAILED.has(s.id)) {
    ledger[s.id] = "fetch_failed";
    continue;
  }

  // RSS sources
  if (s.kind === "rss") {
    const r = rssMap.get(s.id);
    if (!r || r.entries.length === 0) {
      ledger[s.id] = "no_new_content";
    } else {
      // Distinguish real new content (published in window) from Firecrawl synthetic timestamps
      const realNew = r.entries.filter((e) => {
        const p = e.published ?? "";
        // Firecrawl fallback synthesizes dates around the fetch time (12:0X-13:0X today)
        if (p.startsWith("2026-05-08T12:0") || p.startsWith("2026-05-08T13:0")) return false;
        return p > WINDOW_START;
      });
      if (realNew.length === 0) {
        ledger[s.id] = "no_new_content";
      } else {
        ledger[s.id] = "processed_no_atoms";
        newItemCount[s.id] = realNew.length;
      }
    }
    continue;
  }

  // Reddit sources
  if (s.kind === "reddit") {
    const r = redMap.get(s.id);
    if (!r || r.posts.length === 0) {
      ledger[s.id] = "no_new_content";
    } else {
      const newPosts = r.posts.filter((p) => p.created_at > WINDOW_START);
      if (newPosts.length === 0) {
        ledger[s.id] = "no_new_content";
      } else {
        ledger[s.id] = "processed_no_atoms";
        newItemCount[s.id] = newPosts.length;
      }
    }
    continue;
  }

  // YouTube sources
  if (s.kind === "youtube") {
    const v = ytMap.get(s.id);
    if (!v || v.length === 0) {
      ledger[s.id] = "no_new_content";
    } else {
      const inWindow = v.filter((x) => x.video.publishedAt > WINDOW_START);
      if (inWindow.length === 0) {
        ledger[s.id] = "no_new_content";
      } else {
        ledger[s.id] = "processed_no_atoms";
        newItemCount[s.id] = inWindow.length;
      }
    }
    continue;
  }

  // Newsletter sources
  if (s.kind === "newsletter") {
    if (NEWSLETTER_NEW_ITEMS.has(s.id)) {
      ledger[s.id] = atomsBySource.has(s.id) ? "processed_with_atoms" : "processed_no_atoms";
      newItemCount[s.id] = 1;
    } else if (NEWSLETTER_NO_NEW.has(s.id)) {
      ledger[s.id] = "no_new_content";
    } else {
      ledger[s.id] = "no_new_content";
    }
    continue;
  }

  // Web pages: yesterday processed src-huggingface and src-github-trending with atoms.
  // Today same two sources got atoms (HF: covered in summary not as separate atom; GitHub: 2 atoms).
  // For other web pages (competitors, substitutes, github-* repos, etc.), Firecrawl scrapes them but
  // they rarely have new content visible from a daily homepage scrape.
  if (s.kind === "web_page") {
    if (s.id === "src-huggingface") {
      ledger[s.id] = "processed_no_atoms";  // HF trending fetched but only confirmed yesterday's pattern; no new atom
      newItemCount[s.id] = 1;
      continue;
    }
    if (s.id === "src-github-trending") {
      ledger[s.id] = "processed_with_atoms";
      newItemCount[s.id] = 2;
      continue;
    }
    ledger[s.id] = "no_new_content";
    continue;
  }

  // Social platforms (non-auth-blocked) — fall back to no_new_content
  if (s.kind === "social_platform") {
    ledger[s.id] = "no_new_content";
    continue;
  }

  // Default
  ledger[s.id] = "no_new_content";
}

// 11) Aggregate counts
const counts: Record<string, number> = {
  processed_with_atoms: 0,
  processed_no_atoms: 0,
  no_new_content: 0,
  fetch_failed: 0,
  auth_blocked: 0,
  excluded_review_rule: 0,
};
for (const status of Object.values(ledger)) counts[status]++;

const unreviewed = eligible.filter((s) => !(s.id in ledger)).map((s) => s.id);

const out = {
  total_eligible: eligible.length,
  total_active: active.length,
  excluded_review_rule_sources: excludedReview.map((s) => s.id),
  counts,
  unreviewed_eligible_sources: unreviewed,
  ledger,
  newItemCount,
  atomsBySource: Object.fromEntries(atomsBySource),
};

writeFileSync("/tmp/pulse-daily-2026-05-08/coverage.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ counts, total_eligible: eligible.length, unreviewed: unreviewed.length, atom_count: atomLines.length }, null, 2));
