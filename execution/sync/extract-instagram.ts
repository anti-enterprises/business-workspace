/**
 * Instagram extractor — reads all active social_platform sources with
 * instagram.com URLs and runs them through the Apify profile scraper.
 *
 * Output shape mirrors extract-x.ts / extract-reddit.ts: per-source result
 * with sourceId/sourceLabel + normalized posts, suitable for the daily
 * aggregator to consume.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { RepoSourceFile } from "../types/source.js";
import {
  scrapeIgProfiles,
  type IgPost,
  type IgProfile,
} from "../apis/instagram.js";

const REPO_SOURCES_DIR = join(process.cwd(), "sources");

export interface IgSource {
  id: string;
  label: string;
  url: string;
  username: string;
  strategic_role: string;
  tags?: string[];
}

export interface IgSourceResult {
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  profile: IgProfile | null;
  posts: IgPost[];
  error?: string;
}

// --- Source loading ---

export function loadIgSources(): IgSource[] {
  if (!existsSync(REPO_SOURCES_DIR)) return [];
  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));
  const sources: IgSource[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    for (const source of parsed.sources) {
      if (source.kind !== "social_platform" || source.status !== "active") continue;
      if (!source.url || !/instagram\.com\//i.test(source.url)) continue;

      const username = extractUsername(source.url);
      if (!username) continue;

      sources.push({
        id: source.id,
        label: source.label,
        url: source.url,
        username,
        strategic_role: source.strategic_role,
        tags: source.tags,
      });
    }
  }

  return sources;
}

function extractUsername(url: string): string | null {
  const m = url.match(/instagram\.com\/([A-Za-z0-9_.]+)\/?/);
  return m?.[1] ?? null;
}

// --- Extraction pipeline ---

export interface ExtractIgOpts {
  /** Cap on posts per profile. Default 30. */
  resultsLimit?: number;
}

export async function extractIgSources(opts: ExtractIgOpts = {}): Promise<IgSourceResult[]> {
  const sources = loadIgSources();
  if (sources.length === 0) {
    console.log("No active Instagram sources found.");
    return [];
  }

  console.log(`Scraping ${sources.length} Instagram profile(s)...`);

  const urls = sources.map((s) => s.url);
  let resultsByUrl: Awaited<ReturnType<typeof scrapeIgProfiles>>;
  try {
    resultsByUrl = await scrapeIgProfiles(urls, { resultsLimit: opts.resultsLimit ?? 30 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Apify error: ${msg}`);
    return sources.map((s) => ({
      sourceId: s.id,
      sourceLabel: s.label,
      sourceUrl: s.url,
      profile: null,
      posts: [],
      error: msg,
    }));
  }

  const out: IgSourceResult[] = [];
  for (const source of sources) {
    const key = source.url.replace(/\/?$/, "/");
    const bucket = resultsByUrl.get(key) ?? { profile: null, posts: [] };
    console.log(
      `  @${source.username}: ${bucket.posts.length} posts${bucket.error ? ` (error: ${bucket.error})` : ""}`,
    );
    out.push({
      sourceId: source.id,
      sourceLabel: source.label,
      sourceUrl: source.url,
      profile: bucket.profile,
      posts: bucket.posts,
      error: bucket.error,
    });
  }

  return out;
}

// --- CLI entrypoint ---

if (
  process.argv[1]?.endsWith("extract-instagram.ts") ||
  process.argv[1]?.endsWith("extract-instagram.js")
) {
  const resultsLimit = parseInt(process.argv[2] ?? "30", 10);

  extractIgSources({ resultsLimit })
    .then((results) => {
      console.log(`\n--- Summary ---`);
      console.log(`Sources: ${results.length}`);
      console.log(`Total posts: ${results.reduce((s, r) => s + r.posts.length, 0)}`);
      console.log(`Errors: ${results.filter((r) => r.error).length}`);
    })
    .catch((err) => {
      console.error("Extraction failed:", err);
      process.exit(1);
    });
}
