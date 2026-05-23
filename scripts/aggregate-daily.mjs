import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parse } from "yaml";

const WORKSPACE_ID = process.env.PULSE_WORKSPACE_ID ?? "business-workspace";
const PULSE = join(homedir(), ".pulse/workspaces", WORKSPACE_ID, "sources/sources.yaml");
const RSS = "/tmp/pulse-daily-2026-05-12/rss.json";
const REDDIT = "/tmp/pulse-daily-2026-05-12/reddit.json";
const REDDIT_DEEP = "/tmp/pulse-daily-2026-05-12/reddit-deep.json";
const YT = "/tmp/pulse-daily-2026-05-12/youtube.json";
const SPA = "/tmp/pulse-daily-2026-05-12/spa-index.json";
const X_JSON = "/tmp/pulse-daily-2026-05-12/x.json";

// Window: yesterday's run completed 2026-05-11T12:30Z
const WINDOW_START = "2026-05-11T12:30:00Z";
const NOW = "2026-05-12T16:00:00Z";

const SYNTH_TIMESTAMP_RE = /^2026-05-12T1[2-6]:[23]\d:/; // Firecrawl fallback synth time range

const sourcesRaw = parse(readFileSync(PULSE, "utf-8"));
const allSources = sourcesRaw.sources;
const active = allSources.filter((s) => s.status === "active");

const isExcluded = (s) =>
  s.kind === "review_aggregator" ||
  s.strategic_role === "review_aggregator" ||
  (s.tags || []).includes("software_reviews");

const eligible = active.filter((s) => !isExcluded(s));
const excludedReview = active.filter((s) => isExcluded(s));

// Load adapter outputs
const rss = JSON.parse(readFileSync(RSS, "utf-8"));
const reddit = JSON.parse(readFileSync(REDDIT, "utf-8"));
const redditDeep = JSON.parse(readFileSync(REDDIT_DEEP, "utf-8"));
const yt = JSON.parse(readFileSync(YT, "utf-8"));
const spa = JSON.parse(readFileSync(SPA, "utf-8"));
const xRes = JSON.parse(readFileSync(X_JSON, "utf-8"));

// Build per-source new-content map
const newContent = new Map();

// Helpers
const real = (pub) => {
  if (!pub) return false;
  if (SYNTH_TIMESTAMP_RE.test(pub)) return false;
  return pub >= WINDOW_START && pub <= NOW;
};

// RSS
for (const s of rss) {
  const realEntries = (s.entries || []).filter((e) => real(e.published));
  if (realEntries.length > 0) {
    newContent.set(s.sourceId, { kind: "rss", entries: realEntries });
  }
}

// SPA-index — overrides any RSS entry for the same source if real
for (const s of spa) {
  const realEntries = (s.entries || []).filter(
    (e) => real(e.published) && !/sorry,? looks like this page does not exist/i.test(e.title || "")
  );
  if (realEntries.length > 0) {
    const existing = newContent.get(s.sourceId);
    const merged = existing ? [...existing.entries, ...realEntries] : realEntries;
    newContent.set(s.sourceId, { kind: "spa", entries: merged });
  }
}

// Reddit (OP-only RSS) — match by source.id which corresponds to e.g. reddit-msp
for (const s of reddit) {
  const sourceId = s.source?.id;
  if (!sourceId) continue;
  // Map "reddit-msp" -> "src-reddit-msp" via lookup in sources.yaml
  const matching = eligible.find(
    (src) => src.kind === "reddit" && (src.id === sourceId || src.id === `src-${sourceId}` || src.subreddit === sourceId.replace(/^reddit-/, "") || src.id.replace(/^src-/, "") === sourceId)
  );
  const realPosts = (s.posts || []).filter((p) => p.created_at && p.created_at >= WINDOW_START);
  if (realPosts.length > 0 && matching) {
    newContent.set(matching.id, { kind: "reddit", posts: realPosts });
  } else if (realPosts.length > 0) {
    // No matching workspace source — track by raw id
    newContent.set(`reddit-raw-${sourceId}`, { kind: "reddit", posts: realPosts, unmatched: true });
  }
}

// Reddit deep — same mapping if any posts/comments returned
for (const s of redditDeep) {
  const sourceId = s.source?.id;
  if (!sourceId) continue;
  const matching = eligible.find(
    (src) => src.kind === "reddit" && (src.id === sourceId || src.id === `src-${sourceId}` || src.id.replace(/^src-/, "") === sourceId)
  );
  if (!matching) continue;
  const posts = (s.posts || []).filter((p) => p.created_at && p.created_at >= WINDOW_START);
  if (posts.length === 0) continue;
  const existing = newContent.get(matching.id) || { kind: "reddit", posts: [] };
  newContent.set(matching.id, {
    kind: "reddit",
    posts: existing.posts.concat(posts),
    comments: s.comments || [],
  });
}

// YouTube
for (const v of yt) {
  if (!real(v.video?.publishedAt)) continue;
  const sourceId = v.sourceId;
  const existing = newContent.get(sourceId);
  const arr = existing?.videos || [];
  arr.push(v.video);
  newContent.set(sourceId, { kind: "youtube", videos: arr });
}

// Coverage ledger
const ledger = {};
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

// Carry-over fetch-failures from yesterday — verify per run
const FETCH_FAILED = new Set(["src-producthunt", "src-reddit-msp-sales"]);

// Today's reddit-deep timeouts
for (const s of redditDeep) {
  // These sources also have OP-only RSS coverage, so don't mark as fetch_failed — they're covered by reddit
}

// Reddit-deep timed out for all 6 but reddit (RSS) succeeded. So those sources are still processed via RSS.

for (const s of eligible) {
  if (newContent.has(s.id)) {
    const nc = newContent.get(s.id);
    // Will be classified as processed_with_atoms or processed_no_atoms after extraction
    ledger[s.id] = { status: "_pending_extract", new_items: itemCount(nc) };
    continue;
  }
  if (AUTH_BLOCKED.has(s.id)) {
    ledger[s.id] = { status: "auth_blocked" };
    continue;
  }
  if (FETCH_FAILED.has(s.id)) {
    ledger[s.id] = { status: "fetch_failed" };
    continue;
  }
  ledger[s.id] = { status: "no_new_content" };
}

function itemCount(nc) {
  if (nc.entries) return nc.entries.length;
  if (nc.posts) return nc.posts.length;
  if (nc.videos) return nc.videos.length;
  return 0;
}

const unreviewed = eligible.filter((s) => !ledger[s.id]).map((s) => s.id);

const out = {
  total_active: active.length,
  total_eligible: eligible.length,
  excluded_review_rule_sources: excludedReview.map((s) => s.id),
  ledger,
  unreviewed_eligible_sources: unreviewed,
  new_content_summary: Array.from(newContent.entries()).map(([id, nc]) => ({
    id,
    kind: nc.kind,
    n: itemCount(nc),
    unmatched: nc.unmatched || false,
  })),
};

writeFileSync(
  "/tmp/pulse-daily-2026-05-12/aggregate.json",
  JSON.stringify(out, null, 2),
);
writeFileSync(
  "/tmp/pulse-daily-2026-05-12/new-content.json",
  JSON.stringify(Object.fromEntries(newContent), null, 2),
);

const cnts = { _pending_extract: 0, no_new_content: 0, fetch_failed: 0, auth_blocked: 0 };
for (const v of Object.values(ledger)) cnts[v.status] = (cnts[v.status] || 0) + 1;
console.log("eligible:", eligible.length, "ledger sizes:", cnts);
console.log("unreviewed:", unreviewed.length);
console.log("new-content sources:", newContent.size);
