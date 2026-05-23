/**
 * One-shot daily extractor: runs all canonical adapters in parallel,
 * dumps fetched content as JSON to /tmp/pulse-daily-2026-05-09/.
 * Used by /pulse-daily SKILL execution.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  extractRssSources,
  extractSpaIndex,
  loadRssSources,
} from "../execution/sync/extract-rss.js";
import { extractRedditSources } from "../execution/sync/extract-reddit.js";
import { extractYouTubeSources } from "../execution/sync/extract-youtube.js";
import { extractXSources } from "../execution/sync/extract-x.js";

const OUT_DIR = "/tmp/pulse-daily-2026-05-19";
mkdirSync(OUT_DIR, { recursive: true });

const adapter = process.argv[2];

async function runRss() {
  console.log("=== RSS ===");
  const results = await extractRssSources(1);
  writeFileSync(join(OUT_DIR, "rss.json"), JSON.stringify(results, null, 2));
  console.log(`RSS: ${results.length} sources, ${results.reduce((a, r) => a + r.entries.length, 0)} entries`);
}

async function runReddit() {
  console.log("=== REDDIT (daily, OP-only RSS) ===");
  const results = await extractRedditSources({ mode: "daily" });
  writeFileSync(join(OUT_DIR, "reddit.json"), JSON.stringify(results, null, 2));
  console.log(`Reddit: ${results.length} sources, ${results.reduce((a, r) => a + r.posts.length, 0)} posts`);
}

async function runRedditDeep() {
  console.log("=== REDDIT DEEP (Apify, msp/icp_voice) ===");
  if (!process.env.APIFY_API_TOKEN) {
    console.log("APIFY_API_TOKEN not set; skipping deep pass");
    writeFileSync(join(OUT_DIR, "reddit-deep.json"), JSON.stringify([], null, 2));
    return;
  }
  // Reddit sources don't have tier_0/daily_slot tags; the equivalent priority subs
  // for the AE workspace are tagged msp/icp_voice (workspace_status atoms confirm this).
  const results = await extractRedditSources({
    mode: "daily",
    deep: true,
    filterTags: ["msp", "icp_voice"],
    overrides: { crawlComments: true, maxCommentsPerPost: 5 },
  });
  writeFileSync(join(OUT_DIR, "reddit-deep.json"), JSON.stringify(results, null, 2));
  console.log(`Reddit deep: ${results.length} sources, ${results.reduce((a, r) => a + r.posts.length, 0)} posts, ${results.reduce((a, r) => a + r.comments.length, 0)} comments`);
}

async function runYoutube() {
  console.log("=== YOUTUBE (1d, no transcripts) ===");
  const results = await extractYouTubeSources(1, false);
  writeFileSync(join(OUT_DIR, "youtube.json"), JSON.stringify(results, null, 2));
  console.log(`YouTube: ${results.length} videos`);
}

async function runX() {
  console.log("=== X / TWITTER (1d) ===");
  try {
    const results = await extractXSources(1);
    writeFileSync(join(OUT_DIR, "x.json"), JSON.stringify(results, null, 2));
    console.log(`X: ${results.length} tweets`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`X failed: ${msg}`);
    writeFileSync(join(OUT_DIR, "x-error.json"), JSON.stringify({ error: msg }, null, 2));
  }
}

async function runSpaIndex() {
  console.log("=== SPA INDEX (Firecrawl-backed multi-post extraction) ===");
  // Optional --source=<id> flag to test a single source
  const sourceArg = process.argv.find((a) => a.startsWith("--source="));
  const sourceFilter = sourceArg ? sourceArg.split("=")[1] : null;
  const all = loadRssSources();
  const spaSources = all.filter(
    (s) => s.spaExtraction?.enabled && (!sourceFilter || s.id === sourceFilter),
  );
  if (spaSources.length === 0) {
    console.log(
      sourceFilter
        ? `No SPA-enabled source matching --source=${sourceFilter}.`
        : "No sources have spa_extraction.enabled=true. Configure pilot sources first.",
    );
    return;
  }
  console.log(`Processing ${spaSources.length} SPA source(s)...`);
  const results = [];
  for (const s of spaSources) {
    try {
      const r = await extractSpaIndex(s);
      if (r) results.push(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${s.label}: FAILED — ${msg}`);
    }
  }
  writeFileSync(join(OUT_DIR, "spa-index.json"), JSON.stringify(results, null, 2));
  const totalEntries = results.reduce((a, r) => a + r.entries.length, 0);
  console.log(
    `SPA-index: ${results.length} sources, ${totalEntries} entries`,
  );
}

const map: Record<string, () => Promise<void>> = {
  rss: runRss,
  reddit: runReddit,
  "reddit-deep": runRedditDeep,
  youtube: runYoutube,
  x: runX,
  "spa-index": runSpaIndex,
};

if (!adapter || !map[adapter]) {
  console.error(
    `Usage: tsx run-daily-extract.ts <rss|reddit|reddit-deep|youtube|x|spa-index> [--source=<id>]`,
  );
  process.exit(1);
}

map[adapter]().catch((err) => {
  console.error(err);
  process.exit(1);
});
