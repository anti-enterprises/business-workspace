import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { RepoSourceFile, type SpaExtraction } from "../types/source.js";
import { fetchFeed, type FeedEntry } from "../apis/rss.js";
import { scrapeUrl, scrapeUrlWithLinks } from "../apis/firecrawl.js";
import { hasApiKey } from "../config/env.js";
import {
  readSeenLinksCache,
  selectNewLinks,
  writeSeenLinksCache,
} from "./seen-links-cache.js";

const REPO_SOURCES_DIR = join(process.cwd(), "sources");

// --- Types ---

export type ExtractionMethod = "rss" | "firecrawl_index_blob" | "firecrawl_spa_posts";

export interface RssSource {
  id: string;
  label: string;
  url: string;
  feedUrl: string | null;
  strategic_role: string;
  tags?: string[];
  notes?: string;
  spaExtraction?: SpaExtraction;
}

export interface FeedWithSource {
  sourceId: string;
  sourceLabel: string;
  feedTitle: string;
  entries: FeedEntry[];
  extractionMethod?: ExtractionMethod;
}

// --- Source loading ---

/**
 * Load all active RSS sources from repo YAML files.
 * Returns sources with or without feed_url — Firecrawl handles the fallback.
 */
export function loadRssSources(): RssSource[] {
  if (!existsSync(REPO_SOURCES_DIR)) return [];

  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));
  const sources: RssSource[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    for (const source of parsed.sources) {
      if (source.kind === "rss" && source.status === "active") {
        sources.push({
          id: source.id,
          label: source.label,
          url: source.url ?? "",
          feedUrl: source.feed_url ?? null,
          strategic_role: source.strategic_role,
          tags: source.tags,
          notes: source.notes,
          spaExtraction: source.spa_extraction,
        });
      }
    }
  }

  return sources;
}

// --- SPA index extraction (Path C) ---

/**
 * Derive a default post-link regex from a source's index URL.
 *
 * Example: `https://www.anthropic.com/news` ->
 *   /^https:\/\/www\.anthropic\.com\/news\/[\w%-]+\/?$/
 *
 * Hand-set `spa_extraction.post_link_pattern` if the SPA puts posts at a
 * deeper path (e.g. /news/2026/05/slug).
 */
function derivePostLinkPattern(indexUrl: string): RegExp {
  const trimmed = indexUrl.replace(/\/$/, "");
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}/[\\w%-]+/?$`);
}

function extractTitleFromMarkdown(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : fallback;
}

/**
 * Slug-derived title as a last-resort fallback. e.g.
 *   `https://www.cerebras.ai/blog/introducing-multi-lora-on-cerebras-inference`
 *   -> "Introducing Multi Lora On Cerebras Inference"
 */
function slugToTitle(url: string): string {
  try {
    const u = new URL(url);
    const slug = u.pathname.replace(/\/$/, "").split("/").pop() ?? "";
    if (!slug) return "";
    return slug
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

/**
 * Pick the most informative title from the scraped page. The Firecrawl
 * `metadata.title` is often just the site name on JS-rendered SPAs ("Cerebras",
 * "Mistral AI"); when that happens, prefer the markdown H1, then a slug-derived
 * title. A title is considered "substantive" if it has at least 3 words OR
 * contains punctuation suggestive of a real title (`:` `|` `—`).
 */
function pickBestTitle(
  scrapedTitle: string,
  markdown: string,
  url: string,
  sourceLabel: string,
): string {
  const isSubstantive = (t: string) => {
    if (!t) return false;
    if (t === sourceLabel) return false;
    const wordCount = t.trim().split(/\s+/).length;
    if (wordCount >= 3) return true;
    return /[:\|—–]/.test(t);
  };

  if (isSubstantive(scrapedTitle)) return scrapedTitle;
  const h1 = extractTitleFromMarkdown(markdown, "");
  if (isSubstantive(h1)) return h1;
  const slug = slugToTitle(url);
  if (isSubstantive(slug)) return slug;
  return scrapedTitle || h1 || slug || sourceLabel;
}

/**
 * Detect and strip a vendor-tagline boilerplate suffix shared across multiple
 * post titles from the same source. SPAs commonly set every page's `<title>`
 * to `{post title} | {site tagline}` (e.g. Groq's
 * `"Introducing MCP Connectors in Beta on GroqCloud | Groq is fast, low cost
 * inference."`). The shared tagline pollutes downstream LLM prompts.
 *
 * Approach: look at the suffix after the last separator (` | ` ` - ` ` — ` ` – `)
 * across all titles in the batch. If ≥2 titles share the same trailing segment
 * AND that segment is at least 4 characters and not present at the end of EVERY
 * post title's *prefix* portion (so we don't strip a real shared topic), strip
 * it from every title.
 *
 * If the batch has only 1 title, fall back to a single-title heuristic: strip
 * the trailing segment when it explicitly contains the source label.
 */
const SUFFIX_SEPARATOR_RE = /\s*[|\-—–]\s+/;

function findCommonSuffix(titles: string[]): string | null {
  // Extract candidate suffixes from each title (text after last separator)
  const suffixes: string[] = [];
  for (const t of titles) {
    const parts = t.split(SUFFIX_SEPARATOR_RE);
    if (parts.length < 2) {
      // No separator → no candidate suffix from this title
      continue;
    }
    suffixes.push(parts[parts.length - 1].trim());
  }
  if (suffixes.length < 2) return null;

  // Find the most common suffix
  const counts = new Map<string, number>();
  for (const s of suffixes) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [s, c] of counts) {
    if (c > bestCount && s.length >= 4) {
      best = s;
      bestCount = c;
    }
  }
  // Need ≥2 occurrences AND ≥50% of the title batch to consider it boilerplate
  if (bestCount < 2 || bestCount < titles.length / 2) return null;
  return best;
}

function stripBoilerplateSuffix(titles: string[], sourceLabel: string): string[] {
  if (titles.length === 0) return titles;

  // Cross-batch common suffix detection
  const common = findCommonSuffix(titles);
  if (common) {
    return titles.map((t) => {
      const parts = t.split(SUFFIX_SEPARATOR_RE);
      if (parts.length >= 2 && parts[parts.length - 1].trim() === common) {
        return parts.slice(0, -1).join(" | ").trim() || t;
      }
      return t;
    });
  }

  // Single-title fallback: strip suffix containing the source label
  if (titles.length === 1) {
    const t = titles[0];
    const parts = t.split(SUFFIX_SEPARATOR_RE);
    if (parts.length >= 2) {
      const tail = parts[parts.length - 1];
      if (
        tail.toLowerCase().includes(sourceLabel.toLowerCase()) &&
        tail.length >= 4
      ) {
        return [parts.slice(0, -1).join(" | ").trim() || t];
      }
    }
  }

  return titles;
}

/**
 * Fetch a single sitemap URL and parse `<loc>` entries. If the sitemap is a
 * sitemap-index (each entry is `<sitemap><loc>...</loc></sitemap>`), recurse
 * into nested sitemaps that share the source's host. Bounded recursion depth
 * to avoid infinite loops; bounded child-sitemap count to bound runtime.
 */
async function fetchSitemap(url: string, depth = 0, maxChildren = 5): Promise<string[]> {
  if (depth > 2) return [];
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "application/xml,text/xml,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    if (xml.length < 50 || !/<\?xml|<urlset|<sitemapindex/i.test(xml)) return [];

    // Sitemap-index → recurse
    if (/<sitemapindex/i.test(xml)) {
      const childUrls = Array.from(xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi))
        .map((m) => m[1].trim())
        .slice(0, maxChildren);
      const results = await Promise.allSettled(
        childUrls.map((u) => fetchSitemap(u, depth + 1, maxChildren)),
      );
      const all: string[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") all.push(...r.value);
      }
      return all;
    }

    // Regular sitemap → extract <loc> entries
    return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map((m) => m[1].trim());
  } catch {
    return [];
  }
}

/**
 * Discover candidate post URLs from the source's sitemap.xml. Tries
 * `<scheme>://<host>/sitemap.xml` first, then `<source.url>/sitemap.xml`.
 * Returns deduped URLs from whichever sitemap responds with valid XML, or
 * an empty list if neither works.
 *
 * Used as a primary discovery mechanism alongside Firecrawl's link extraction:
 * sitemaps are static, machine-readable, and resilient to JS-rendering and
 * anti-bot WAFs that block the index page.
 */
async function fetchSitemapLinks(sourceUrl: string): Promise<string[]> {
  let host: string;
  try {
    host = new URL(sourceUrl).origin;
  } catch {
    return [];
  }

  // Try root /sitemap.xml first (most common)
  const rootSitemap = `${host}/sitemap.xml`;
  let urls = await fetchSitemap(rootSitemap);

  // Fallback: <index_url>/sitemap.xml
  if (urls.length === 0) {
    const trimmed = sourceUrl.replace(/\/$/, "");
    if (trimmed !== host && !trimmed.endsWith("/sitemap.xml")) {
      urls = await fetchSitemap(`${trimmed}/sitemap.xml`);
    }
  }

  return Array.from(new Set(urls));
}

/**
 * SPA-index path. Scrape the source's index page once with formats=['markdown','links'],
 * filter the link list to candidate posts, diff against the per-source seen-links cache,
 * scrape each new post for full content, and emit one FeedEntry per post.
 *
 * Discovery is a UNION of two sources: (1) Firecrawl-extracted links from the
 * index page, and (2) static `/sitemap.xml` parsing. The union is robust to
 * JS-rendered SPAs (where Firecrawl static link extraction may return 0
 * candidates) and to anti-bot WAFs blocking the index page itself.
 */
export async function extractSpaIndex(
  source: RssSource,
  options: { perPostConcurrency?: number; budgetRemaining?: number } = {},
): Promise<FeedWithSource | null> {
  const cfg = source.spaExtraction;
  if (!cfg || !cfg.enabled || !source.url) return null;

  // 1a. Scrape the index page with link extraction (best-effort)
  let idxLinks: string[] = [];
  let idxTitle = "";
  try {
    const idx = await scrapeUrlWithLinks(source.url);
    idxLinks = idx.links;
    idxTitle = idx.title;
  } catch {
    // Index unreachable (404 / 403 / SPA error) — sitemap fallback may still rescue.
  }

  // 1b. Sitemap-based discovery (parallel candidate source)
  const sitemapLinks = await fetchSitemapLinks(source.url);
  if (sitemapLinks.length > 0 && idxLinks.length === 0) {
    console.log(`  ${source.label}: sitemap rescue — ${sitemapLinks.length} URLs from sitemap.xml`);
  }

  // 2. Filter the union of discovered links to candidate post URLs
  const pattern = cfg.post_link_pattern
    ? new RegExp(cfg.post_link_pattern)
    : derivePostLinkPattern(source.url);
  const exclude = cfg.exclude_pattern ? new RegExp(cfg.exclude_pattern) : null;
  const allCandidates = Array.from(new Set([...idxLinks, ...sitemapLinks]));
  const candidatePosts = allCandidates
    .filter((l) => pattern.test(l))
    .filter((l) => !exclude || !exclude.test(l))
    .filter((l) => l !== source.url && l !== `${source.url}/`);

  // 3. Diff against the cache
  const cache = readSeenLinksCache(source.id);
  const cap = Math.min(
    cfg.max_posts_per_run,
    options.budgetRemaining ?? cfg.max_posts_per_run,
  );
  const newLinks = selectNewLinks(candidatePosts, cache, cfg.post_age_days, cap);

  // 4. Scrape each new post (bounded concurrency)
  const perPostConcurrency = options.perPostConcurrency ?? 2;
  const posts: (Awaited<ReturnType<typeof scrapeUrl>> | null)[] = [];
  for (let i = 0; i < newLinks.length; i += perPostConcurrency) {
    const batch = newLinks.slice(i, i + perPostConcurrency);
    const settled = await Promise.allSettled(batch.map((l) => scrapeUrl(l)));
    for (const r of settled) {
      posts.push(r.status === "fulfilled" ? r.value : null);
    }
  }

  // 5. Convert to FeedEntries
  const rawEntries: (FeedEntry | null)[] = posts.map((p, i) => {
    if (!p) return null;
    const title = pickBestTitle(p.title, p.markdown, newLinks[i], source.label);
    return {
      title,
      link: newLinks[i],
      published: p.published || new Date().toISOString(),
      description: p.description || p.markdown.slice(0, 600),
    } satisfies FeedEntry;
  });

  // Post-process titles: detect + strip vendor-boilerplate suffix shared across
  // the batch (e.g. "Foo Post | Groq is fast, low cost inference." → "Foo Post").
  const validEntries = rawEntries.filter(
    (e): e is FeedEntry => e !== null,
  );
  const cleanedTitles = stripBoilerplateSuffix(
    validEntries.map((e) => e.title),
    source.label,
  );
  const entries: FeedEntry[] = validEntries.map((e, i) => ({
    ...e,
    title: cleanedTitles[i],
  }));

  // 6. Update the cache with all candidate posts (cached even if not scraped this run,
  // so subsequent runs short-circuit them)
  writeSeenLinksCache(source.id, candidatePosts, cache);

  if (newLinks.length > 0) {
    console.log(
      `  ${source.label}: SPA index — ${candidatePosts.length} candidates, ${entries.length} new posts scraped`,
    );
  }

  return {
    sourceId: source.id,
    sourceLabel: source.label,
    feedTitle: idxTitle || source.label,
    entries,
    extractionMethod: "firecrawl_spa_posts",
  };
}

// --- Extraction pipeline ---

/**
 * Extract recent posts from all active RSS sources.
 * Used during manual Pulse weekly runs.
 */
export async function extractRssSources(
  daysBack = 7,
  options: { tagsFilter?: string[]; concurrency?: number; maxFirecrawlPerRun?: number } = {},
): Promise<FeedWithSource[]> {
  const allSources = loadRssSources();
  const sources = options.tagsFilter
    ? allSources.filter((s) => s.tags?.some((t) => options.tagsFilter!.includes(t)))
    : allSources;

  if (sources.length === 0) {
    console.log("No active RSS sources found.");
    return [];
  }

  const after = new Date(Date.now() - daysBack * 86400000);
  const concurrency = options.concurrency ?? 5;
  const results: FeedWithSource[] = [];

  const canFirecrawl = hasApiKey("FIRECRAWL_API_KEY");
  let rssCount = 0;
  let blobCount = 0;
  let spaCount = 0;
  let firecrawlCallsUsed = 0;
  const firecrawlBudget = options.maxFirecrawlPerRun ?? 800;

  // Process in batches for controlled concurrency
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (source) => {
        try {
          // Path A: RSS feed available
          if (source.feedUrl) {
            const feed = await fetchFeed(source.feedUrl);
            const recent = feed.entries.filter((e) => {
              if (!e.published) return true;
              return new Date(e.published) >= after;
            });

            if (recent.length > 0) {
              console.log(`  ${source.label}: ${recent.length} new posts (RSS)`);
            }
            rssCount++;

            return {
              sourceId: source.id,
              sourceLabel: source.label,
              feedTitle: feed.title,
              entries: recent,
              extractionMethod: "rss" as const,
            };
          }

          // Path C: SPA-index extraction (multi-post via Firecrawl)
          if (canFirecrawl && source.url && source.spaExtraction?.enabled) {
            const budgetRemaining = Math.max(0, firecrawlBudget - firecrawlCallsUsed);
            const spaResult = await extractSpaIndex(source, { budgetRemaining });
            if (spaResult) {
              spaCount++;
              // 1 index scrape + 1 per scraped post
              firecrawlCallsUsed += 1 + spaResult.entries.length;
              return spaResult;
            }
            // fall through to Path B if SPA helper returned null
          }

          // Path B: Single-page Firecrawl fallback (legacy)
          if (canFirecrawl && source.url) {
            const result = await scrapeUrl(source.url);
            firecrawlCallsUsed += 1;
            const entry: FeedEntry = {
              title: result.title || source.label,
              link: result.url,
              published: result.published || new Date().toISOString(),
              description: result.description || result.markdown.slice(0, 500),
            };
            console.log(`  ${source.label}: scraped via Firecrawl`);
            blobCount++;

            return {
              sourceId: source.id,
              sourceLabel: source.label,
              feedTitle: result.title || source.label,
              entries: [entry],
              extractionMethod: "firecrawl_index_blob" as const,
            };
          }

          // No feed URL and no Firecrawl — skip
          return null;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ${source.label}: FAILED — ${msg}`);
          return null;
        }
      }),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
      }
    }
  }

  console.log(
    `\n  Extraction methods: ${rssCount} via RSS, ${blobCount} via Firecrawl (single-page), ${spaCount} via SPA-index`,
  );
  console.log(
    `  Firecrawl calls used: ${firecrawlCallsUsed} / ${firecrawlBudget} budget`,
  );

  return results;
}

// --- CLI entrypoint ---

if (process.argv[1]?.endsWith("extract-rss.ts") || process.argv[1]?.endsWith("extract-rss.js")) {
  const daysBack = parseInt(process.argv[2] ?? "7", 10);
  const tagsArg = process.argv.find((a) => a.startsWith("--tags="));
  const tagsFilter = tagsArg ? tagsArg.split("=")[1].split(",") : undefined;

  console.log(`Extracting RSS feeds (last ${daysBack} days)...`);
  if (tagsFilter) console.log(`  Filtering by tags: ${tagsFilter.join(", ")}`);

  extractRssSources(daysBack, { tagsFilter })
    .then((results) => {
      const totalEntries = results.reduce((sum, r) => sum + r.entries.length, 0);
      const activeSources = results.filter((r) => r.entries.length > 0).length;

      console.log(`\n--- Summary ---`);
      console.log(`Sources checked: ${results.length}`);
      console.log(`Sources with new posts: ${activeSources}`);
      console.log(`Total new entries: ${totalEntries}`);

      // Show top posts by source
      for (const r of results) {
        if (r.entries.length === 0) continue;
        console.log(`\n  [${r.sourceLabel}] ${r.entries.length} entries`);
        for (const e of r.entries.slice(0, 3)) {
          console.log(`    - ${e.title}`);
        }
        if (r.entries.length > 3) {
          console.log(`    ... and ${r.entries.length - 3} more`);
        }
      }
    })
    .catch((err) => {
      console.error("Extraction failed:", err);
      process.exit(1);
    });
}
