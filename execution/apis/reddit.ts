/**
 * Reddit scraper via Apify actor (9sHOY9RzPYGjmTHo8).
 *
 * Replaces direct Reddit JSON API to avoid rate limits at scale (24+ subreddits).
 * Uses the existing Apify infrastructure (runActor from apify.ts).
 */

import { runActor } from "./apify.js";

const ACTOR_ID = "9sHOY9RzPYGjmTHo8";

// --- Types ---

/** Raw item returned by the Apify Reddit actor. */
export interface ApifyRedditItem {
  id?: string;
  dataType?: string; // "post" | "comment" | "community"
  parsedId?: string;
  url?: string;
  title?: string;
  body?: string;
  username?: string;
  communityName?: string;
  numberOfUpVotes?: number;
  upVoteRatio?: number;
  numberOfComments?: number;
  createdAt?: string;
  flair?: string;
  isNsfw?: boolean;
  isOver18?: boolean;
  html?: string;
  [key: string]: unknown;
}

/** Normalized post for consumption by the extraction pipeline. */
export interface RedditPost {
  id: string;
  title: string;
  body: string;
  author: string;
  subreddit: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_at: string;
  url: string;
  flair: string | null;
}

/** Normalized comment. */
export interface RedditComment {
  id: string;
  body: string;
  author: string;
  score: number;
  created_at: string;
  url: string;
}

// --- Normalization ---

function normalizePost(item: ApifyRedditItem): RedditPost {
  return {
    id: item.parsedId ?? item.id ?? "",
    title: item.title ?? "",
    body: item.body ?? "",
    author: item.username ?? "[deleted]",
    subreddit: item.communityName ?? "",
    score: item.numberOfUpVotes ?? 0,
    upvote_ratio: item.upVoteRatio ?? 0,
    num_comments: item.numberOfComments ?? 0,
    created_at: item.createdAt ?? "",
    url: item.url ?? "",
    flair: item.flair ?? null,
  };
}

function normalizeComment(item: ApifyRedditItem): RedditComment {
  return {
    id: item.parsedId ?? item.id ?? "",
    body: item.body ?? "",
    author: item.username ?? "[deleted]",
    score: item.numberOfUpVotes ?? 0,
    created_at: item.createdAt ?? "",
    url: item.url ?? "",
  };
}

// --- Public API ---

export interface ScrapeSubredditOpts {
  /** Max posts to fetch. */
  maxPosts?: number;
  /** Fetch comments for each post? */
  crawlComments?: boolean;
  /** Max comments per post (when crawlComments is true). */
  maxCommentsPerPost?: number;
  /** Sort order: "new" | "hot" | "top" | "rising". */
  sort?: string;
  /** Time filter for "top" sort: "hour" | "day" | "week" | "month" | "year" | "all". */
  time?: string;
}

/**
 * Scrape a subreddit via Apify actor.
 * Returns normalized posts and (optionally) their comments.
 */
export async function scrapeSubreddit(
  subredditUrl: string,
  opts: ScrapeSubredditOpts = {},
): Promise<{ posts: RedditPost[]; comments: RedditComment[] }> {
  const {
    maxPosts = 25,
    crawlComments = false,
    maxCommentsPerPost = 10,
    sort = "new",
    time = "week",
  } = opts;

  // Build the subreddit listing URL with sort
  let url = subredditUrl.replace(/\/$/, "");
  if (sort === "top") {
    url += `/top/?t=${time}`;
  } else if (sort !== "new") {
    url += `/${sort}/`;
  }

  const input: Record<string, unknown> = {
    searchTerms: [],
    searchPosts: false,
    searchComments: false,
    searchCommunities: false,
    startUrls: [{ url }],
    fastMode: true,
    crawlCommentsPerPost: crawlComments,
    includeNSFW: false,
    maxPostsCount: maxPosts,
    maxCommentsCount: crawlComments ? maxCommentsPerPost * maxPosts : 0,
    maxCommentsPerPost: crawlComments ? maxCommentsPerPost : 0,
    maxCommunitiesCount: 0,
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
  };

  const items = await runActor<ApifyRedditItem>(ACTOR_ID, input);

  const posts: RedditPost[] = [];
  const comments: RedditComment[] = [];

  for (const item of items) {
    if (item.dataType === "comment") {
      comments.push(normalizeComment(item));
    } else {
      // Default to post (some items may not have dataType set)
      posts.push(normalizePost(item));
    }
  }

  return { posts, comments };
}

/**
 * Scrape multiple subreddits in sequence.
 * Returns results keyed by subreddit URL.
 */
export async function scrapeSubreddits(
  subredditUrls: string[],
  opts: ScrapeSubredditOpts = {},
): Promise<Map<string, { posts: RedditPost[]; comments: RedditComment[] }>> {
  const results = new Map<string, { posts: RedditPost[]; comments: RedditComment[] }>();

  for (const url of subredditUrls) {
    try {
      const result = await scrapeSubreddit(url, opts);
      results.set(url, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error scraping ${url}: ${msg}`);
      results.set(url, { posts: [], comments: [] });
    }
  }

  return results;
}
