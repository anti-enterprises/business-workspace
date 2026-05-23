import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { RepoSourceFile } from "../types/source.js";
import { isRepost, isQuote, type XTweet, type XUser } from "../apis/x-twitter.js";
import { scrapeUserTweets } from "../apis/x-apify.js";

const REPO_SOURCES_DIR = join(process.cwd(), "sources");

// --- Types ---

export interface XSource {
  id: string;
  label: string;
  /** Canonical X profile URL — handle form `https://x.com/<handle>` or ID form `https://x.com/i/user/<id>`. */
  url: string;
  strategic_role: string;
  tags?: string[];
  notes?: string;
}

export interface TweetWithContext {
  sourceId: string;
  sourceLabel: string;
  tweet: XTweet;
  isRepost: boolean;
  isQuote: boolean;
  originalAuthor?: string;
}

// --- Source loading ---

/**
 * Load all X/Twitter sources from repo YAML files.
 * Filters for kind: social_platform with x.com or twitter.com URLs.
 */
export function loadXSources(): XSource[] {
  if (!existsSync(REPO_SOURCES_DIR)) return [];

  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));
  const sources: XSource[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    for (const source of parsed.sources) {
      if (source.kind !== "social_platform" || source.status !== "active") continue;
      if (!source.url) continue;
      if (!isXProfileUrl(source.url)) continue;

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
 * Match any X profile URL — `x.com/<handle>` or `x.com/i/user/<id>`,
 * with or without trailing slash. The Apify scraper accepts both via
 * its `startUrls` input, so handles don't need to be pre-resolved.
 */
function isXProfileUrl(url: string): boolean {
  return /(?:x\.com|twitter\.com)\/(?:i\/user\/\d+|[A-Za-z0-9_]+)\/?(?:$|\?)/i.test(url);
}

// --- Extraction pipeline ---

/**
 * Extract recent tweets from all active X sources.
 * Classifies each tweet as original, repost, or quote.
 */
export async function extractXSources(daysBack = 7): Promise<TweetWithContext[]> {
  const sources = loadXSources();
  if (sources.length === 0) {
    console.log("No active X/Twitter sources found.");
    return [];
  }

  const startTime = new Date(Date.now() - daysBack * 86400000).toISOString();
  const results: TweetWithContext[] = [];

  for (const source of sources) {
    console.log(`\nFetching tweets for ${source.label} (${source.url})...`);

    try {
      const { tweets, includes } = await scrapeUserTweets(source.url, {
        startTime,
        maxItems: 100,
        includeRetweets: true,
        includeReplies: false,
      });

      console.log(`  Found ${tweets.length} tweets in last ${daysBack} days`);

      // Build user lookup from includes for author resolution
      const userLookup = new Map<string, XUser>();
      for (const u of includes?.users ?? []) {
        userLookup.set(u.id, u);
      }

      for (const tweet of tweets) {
        const repost = isRepost(tweet);
        const quote = isQuote(tweet);

        let originalAuthor: string | undefined;
        if (repost || quote) {
          // Find the original tweet's author from includes
          const refId = tweet.referenced_tweets?.find(
            (r) => r.type === "retweeted" || r.type === "quoted",
          )?.id;
          const refTweet = includes?.tweets?.find((t) => t.id === refId);
          if (refTweet) {
            const author = userLookup.get(refTweet.author_id);
            originalAuthor = author ? `@${author.username}` : refTweet.author_id;
          }
        }

        results.push({
          sourceId: source.id,
          sourceLabel: source.label,
          tweet,
          isRepost: repost,
          isQuote: quote,
          originalAuthor,
        });
      }

      const reposts = tweets.filter(isRepost).length;
      const quotes = tweets.filter(isQuote).length;
      const originals = tweets.length - reposts - quotes;
      console.log(`  Originals: ${originals}, Reposts: ${reposts}, Quotes: ${quotes}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error fetching ${source.label}: ${msg}`);
    }
  }

  return results;
}

// --- CLI entrypoint ---

if (process.argv[1]?.endsWith("extract-x.ts") || process.argv[1]?.endsWith("extract-x.js")) {
  const daysBack = parseInt(process.argv[2] ?? "7", 10);

  extractXSources(daysBack)
    .then((results) => {
      console.log(`\n--- Summary ---`);
      console.log(`Total tweets: ${results.length}`);
      console.log(`Reposts: ${results.filter((r) => r.isRepost).length}`);
      console.log(`Quotes: ${results.filter((r) => r.isQuote).length}`);
      console.log(`Originals: ${results.filter((r) => !r.isRepost && !r.isQuote).length}`);

      // Show reposts separately as interest signals
      const reposts = results.filter((r) => r.isRepost);
      if (reposts.length > 0) {
        console.log(`\n--- Repost Signals ---`);
        for (const r of reposts) {
          console.log(`  [@${r.originalAuthor}] ${r.tweet.text.slice(0, 100)}...`);
        }
      }
    })
    .catch((err) => {
      console.error("Extraction failed:", err);
      process.exit(1);
    });
}
