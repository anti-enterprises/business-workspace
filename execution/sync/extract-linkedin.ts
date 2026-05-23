/**
 * LinkedIn extractor — reads all active social_platform sources with
 * linkedin.com URLs that point to a specific profile or company page
 * (not the bare linkedin.com root) and runs them through the Apify
 * profile-posts scraper.
 *
 * Mirrors the extract-x / extract-instagram pattern.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { RepoSourceFile } from "../types/source.js";
import {
  scrapeLinkedInProfiles,
  type LinkedInPost,
} from "../apis/linkedin.js";

const REPO_SOURCES_DIR = join(process.cwd(), "sources");

export interface LinkedInSource {
  id: string;
  label: string;
  url: string;
  handle: string; // /in/<slug> or /company/<slug>
  kind: "person" | "company";
  strategic_role: string;
  tags?: string[];
}

export interface LinkedInSourceResult {
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  posts: LinkedInPost[];
  error?: string;
}

// --- Source loading ---

export function loadLinkedInSources(): LinkedInSource[] {
  if (!existsSync(REPO_SOURCES_DIR)) return [];
  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));
  const sources: LinkedInSource[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    for (const source of parsed.sources) {
      if (source.kind !== "social_platform" || source.status !== "active") continue;
      if (!source.url) continue;

      const parsedUrl = parseLinkedInUrl(source.url);
      if (!parsedUrl) continue;

      sources.push({
        id: source.id,
        label: source.label,
        url: source.url,
        handle: parsedUrl.handle,
        kind: parsedUrl.kind,
        strategic_role: source.strategic_role,
        tags: source.tags,
      });
    }
  }

  return sources;
}

function parseLinkedInUrl(url: string): { handle: string; kind: "person" | "company" } | null {
  const personMatch = url.match(/linkedin\.com\/in\/([A-Za-z0-9-]+)\/?/i);
  if (personMatch) return { handle: personMatch[1], kind: "person" };
  const companyMatch = url.match(/linkedin\.com\/company\/([A-Za-z0-9-]+)\/?/i);
  if (companyMatch) return { handle: companyMatch[1], kind: "company" };
  return null; // bare linkedin.com root or other variant — skip
}

// --- Extraction pipeline ---

export interface ExtractLinkedInOpts {
  /** Cap on posts per profile. Default 20. */
  resultsLimit?: number;
}

export async function extractLinkedInSources(
  opts: ExtractLinkedInOpts = {},
): Promise<LinkedInSourceResult[]> {
  const sources = loadLinkedInSources();
  if (sources.length === 0) {
    console.log("No active LinkedIn profile/company sources found.");
    return [];
  }

  console.log(`Scraping ${sources.length} LinkedIn source(s)...`);

  const urls = sources.map((s) => s.url);
  const resultsByUrl = await scrapeLinkedInProfiles(urls, {
    resultsLimit: opts.resultsLimit ?? 20,
  });

  const out: LinkedInSourceResult[] = [];
  for (const source of sources) {
    const bucket = resultsByUrl.get(source.url) ?? { posts: [] };
    console.log(
      `  ${source.url}: ${bucket.posts.length} posts${bucket.error ? ` (error: ${bucket.error})` : ""}`,
    );
    out.push({
      sourceId: source.id,
      sourceLabel: source.label,
      sourceUrl: source.url,
      posts: bucket.posts,
      error: bucket.error,
    });
  }

  return out;
}

// --- CLI entrypoint ---

if (
  process.argv[1]?.endsWith("extract-linkedin.ts") ||
  process.argv[1]?.endsWith("extract-linkedin.js")
) {
  const resultsLimit = parseInt(process.argv[2] ?? "20", 10);

  extractLinkedInSources({ resultsLimit })
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
