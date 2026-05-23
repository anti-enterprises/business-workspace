import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import dotenv from "dotenv";
import { RepoSourceFile } from "../types/source.js";
import { hasApiKey } from "../config/env.js";
import { fetchFeed, type FeedEntry } from "../apis/rss.js";
import {
  scrapeSubreddit,
  type RedditPost,
  type RedditComment,
  type ScrapeSubredditOpts,
} from "../apis/reddit.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const REPO_SOURCES_DIR = join(process.cwd(), "sources");

// --- Types ---

export interface RedditSource {
  id: string;
  label: string;
  subreddit: string;
  url: string;
  strategic_role: string;
  tags?: string[];
  notes?: string;
}

export interface RedditExtractionResult {
  source: RedditSource;
  posts: RedditPost[];
  comments: RedditComment[];
}

// --- Source loading ---

export function loadRedditSources(): RedditSource[] {
  if (!existsSync(REPO_SOURCES_DIR)) return [];

  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));
  const sources: RedditSource[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    for (const source of parsed.sources) {
      if (source.kind !== "reddit" || source.status !== "active") continue;
      if (!source.url) continue;

      const subreddit = extractSubreddit(source.url);
      if (!subreddit) continue;

      sources.push({
        id: source.id,
        label: source.label,
        subreddit,
        url: source.url,
        strategic_role: source.strategic_role,
        tags: source.tags,
        notes: source.notes,
      });
    }
  }

  return sources;
}

function extractSubreddit(url: string): string | null {
  const match = url.match(/reddit\.com\/r\/([a-zA-Z0-9_]+)/);
  return match?.[1] ?? null;
}

// --- Cadence presets ---

interface CadencePreset {
  maxPosts: number;
  crawlComments: boolean;
  maxCommentsPerPost: number;
  sort: string;
  time: string;
}

const PRESETS: Record<string, CadencePreset> = {
  daily: {
    maxPosts: 10,
    crawlComments: false,
    maxCommentsPerPost: 0,
    sort: "hot",
    time: "day",
  },
  weekly: {
    maxPosts: 25,
    crawlComments: true,
    maxCommentsPerPost: 10,
    sort: "top",
    time: "week",
  },
  monthly: {
    maxPosts: 50,
    crawlComments: true,
    maxCommentsPerPost: 25,
    sort: "top",
    time: "month",
  },
};

// --- RSS backend (free, no API key) ---

function buildRedditRssUrl(subreddit: string, sort: string, time: string): string {
  const base = `https://www.reddit.com/r/${subreddit}`;
  if (sort === "top") return `${base}/top/.rss?t=${time}`;
  if (sort === "hot") return `${base}/hot/.rss`;
  if (sort === "new") return `${base}/new/.rss`;
  return `${base}/.rss`;
}

function rssEntryToPost(entry: FeedEntry, subreddit: string, position: number): RedditPost {
  // Extract author from Atom content: "submitted by /u/username"
  const authorMatch = entry.description.match(/\/u\/([a-zA-Z0-9_-]+)/);

  return {
    id: entry.link.match(/comments\/([a-z0-9]+)/)?.[1] ?? entry.link,
    title: entry.title,
    body: entry.description,
    author: authorMatch?.[1] ?? "[unknown]",
    subreddit,
    score: 0, // RSS doesn't include scores — position is the quality signal
    upvote_ratio: 0,
    num_comments: 0,
    created_at: entry.published,
    url: entry.link,
    flair: null,
  };
}

async function extractViaRss(
  source: RedditSource,
  preset: CadencePreset,
): Promise<{ posts: RedditPost[]; comments: RedditComment[] }> {
  const feedUrl = buildRedditRssUrl(source.subreddit, preset.sort, preset.time);
  const feed = await fetchFeed(feedUrl);

  const posts = feed.entries
    .slice(0, preset.maxPosts)
    .map((entry, i) => rssEntryToPost(entry, source.subreddit, i));

  return { posts, comments: [] }; // RSS has no comments
}

// --- Extraction pipeline ---

export interface ExtractOptions {
  mode?: "daily" | "weekly" | "monthly";
  deep?: boolean;
  filterTags?: string[];
  concurrency?: number;
  overrides?: Partial<{
    maxPosts: number;
    crawlComments: boolean;
    maxCommentsPerPost: number;
    sort: string;
    time: string;
  }>;
}

export async function extractRedditSources(
  modeOrOpts: "daily" | "weekly" | "monthly" | ExtractOptions = "weekly",
  filterTags?: string[],
): Promise<RedditExtractionResult[]> {
  // Support both old (mode, filterTags) and new (options) signatures
  const opts: ExtractOptions = typeof modeOrOpts === "string"
    ? { mode: modeOrOpts, filterTags }
    : modeOrOpts;

  const mode = opts.mode ?? "weekly";
  const deep = opts.deep ?? false;
  const concurrency = opts.concurrency ?? 3;

  let sources = loadRedditSources();
  if (sources.length === 0) {
    console.log("No active Reddit sources found.");
    return [];
  }

  if (opts.filterTags && opts.filterTags.length > 0) {
    sources = sources.filter((s) =>
      s.tags?.some((t) => opts.filterTags!.includes(t)),
    );
    console.log(`Filtered to ${sources.length} sources matching tags: ${opts.filterTags.join(", ")}`);
  }

  // Determine backend: --deep uses Apify, default uses RSS
  let useApify = deep;
  if (useApify && !hasApiKey("APIFY_API_TOKEN")) {
    console.warn("⚠ --deep requested but APIFY_API_TOKEN not available. Falling back to RSS.\n");
    useApify = false;
  }

  const preset = { ...PRESETS[mode], ...(opts.overrides ?? {}) };
  const backend = useApify ? "Apify" : "RSS";
  console.log(`Backend: ${backend} | Mode: ${mode} | Posts: ${useApify ? preset.maxPosts : "~25 (RSS limit)"} | Comments: ${useApify && preset.crawlComments ? preset.maxCommentsPerPost + "/post" : "off"} | Sort: ${preset.sort}/${preset.time}`);
  console.log(`Sources: ${sources.length} subreddits\n`);

  const results: RedditExtractionResult[] = [];

  if (useApify) {
    // Apify backend — sequential to manage credits
    for (const source of sources) {
      console.log(`r/${source.subreddit} (${source.label})...`);
      try {
        const apifyOpts: ScrapeSubredditOpts = {
          maxPosts: preset.maxPosts,
          crawlComments: preset.crawlComments,
          maxCommentsPerPost: preset.maxCommentsPerPost,
          sort: preset.sort,
          time: preset.time,
        };
        const { posts, comments } = await scrapeSubreddit(source.url, apifyOpts);
        console.log(`  Posts: ${posts.length}, Comments: ${comments.length}`);
        results.push({ source, posts, comments });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Error: ${msg}`);
        results.push({ source, posts: [], comments: [] });
      }
    }
  } else {
    // RSS backend — concurrent with rate limiting
    for (let i = 0; i < sources.length; i += concurrency) {
      const batch = sources.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (source) => {
          try {
            const { posts, comments } = await extractViaRss(source, preset);
            if (posts.length > 0) {
              console.log(`  ${source.label}: ${posts.length} posts (RSS/${preset.sort})`);
            }
            return { source, posts, comments } as RedditExtractionResult;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ${source.label}: FAILED — ${msg}`);
            return { source, posts: [], comments: [] } as RedditExtractionResult;
          }
        }),
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        }
      }

      // Pause between batches to avoid Reddit rate limiting
      if (i + concurrency < sources.length) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  return results;
}

// --- CLI entrypoint ---

if (
  process.argv[1]?.endsWith("extract-reddit.ts") ||
  process.argv[1]?.endsWith("extract-reddit.js")
) {
  const args = process.argv.slice(2);
  const mode = args.includes("--monthly")
    ? "monthly"
    : args.includes("--daily")
      ? "daily"
      : "weekly";

  const tagsArg = args.find((a) => a.startsWith("--tags="));
  const filterTags = tagsArg ? tagsArg.replace("--tags=", "").split(",") : undefined;

  const deep = args.includes("--deep");
  const dryRun = args.includes("--dry-run");

  if (dryRun) {
    const sources = loadRedditSources();
    const backend = deep ? "Apify (deep)" : "RSS (default)";
    console.log(`[DRY RUN] ${backend} | ${mode} mode | ${sources.length} subreddits:`);
    for (const s of sources) {
      console.log(`  r/${s.subreddit} (${s.label}) [${s.tags?.join(", ") ?? "no tags"}]`);
    }
    process.exit(0);
  }

  console.log(`Reddit extraction — ${mode} mode${deep ? " (DEEP/Apify)" : " (RSS)"}\n`);

  extractRedditSources({ mode, deep, filterTags })
    .then((results) => {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Reddit ${mode} extraction complete`);
      console.log(`${"=".repeat(60)}`);

      let totalPosts = 0;
      let totalComments = 0;

      for (const r of results) {
        totalPosts += r.posts.length;
        totalComments += r.comments.length;

        console.log(`\nr/${r.source.subreddit} (${r.source.label})`);
        console.log(`  Posts: ${r.posts.length}, Comments: ${r.comments.length}`);

        // Show top 5 by score
        const sorted = [...r.posts].sort((a, b) => b.score - a.score);
        if (sorted.length > 0) {
          console.log(`  Top 5:`);
          for (const p of sorted.slice(0, 5)) {
            console.log(`    [${p.score}] ${p.title.slice(0, 80)}`);
          }
        }
      }

      console.log(`\nTotals: ${totalPosts} posts, ${totalComments} comments across ${results.length} subreddits`);
    })
    .catch((err) => {
      console.error("Extraction failed:", err);
      process.exit(1);
    });
}
