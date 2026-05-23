/**
 * X/Twitter scraper via Apify actor (apidojo/twitter-scraper-lite).
 *
 * Replaces direct X API v2 to avoid paid Bearer-token credit dependency.
 * Same dataset shape returned as the v2 client (XTweet) so extract-x.ts
 * does not need to rewire its downstream logic — just swap the data source.
 *
 * Actor: https://apify.com/apidojo/twitter-scraper-lite
 * Cost (2026-05): ~$0.40 / 1K tweets.
 */

import { runActor } from "./apify.js";
import type { XTweet, XUser } from "./x-twitter.js";

const ACTOR_ID = "apidojo~twitter-scraper-lite";

// --- Raw item shape from Apify (subset of fields we use) ---

interface ApifyXItem {
  id?: string;
  id_str?: string;
  url?: string;
  twitterUrl?: string;
  type?: string; // "tweet" | "retweet" | "quote" | "reply"
  full_text?: string;
  text?: string;
  createdAt?: string;
  created_at?: string;
  retweetCount?: number;
  replyCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  author?: {
    id?: string;
    userName?: string;
    name?: string;
    description?: string;
    followers?: number;
    following?: number;
    statusesCount?: number;
  };
  isRetweet?: boolean;
  isQuote?: boolean;
  isReply?: boolean;
  retweetedStatus?: ApifyXItem;
  quotedStatusId?: string;
  quoted_status?: ApifyXItem;
  inReplyToUsername?: string;
  entities?: {
    urls?: Array<{ expanded_url?: string; display_url?: string }>;
  };
  [key: string]: unknown;
}

// --- Public API ---

export interface ScrapeUserTweetsOpts {
  /** Inclusive lower bound for tweet creation time (ISO 8601). */
  startTime?: string;
  /** Inclusive upper bound for tweet creation time (ISO 8601). */
  endTime?: string;
  /** Max tweets to fetch per user. Default: 50. */
  maxItems?: number;
  /** Include retweets in the result. Default: true. */
  includeRetweets?: boolean;
  /** Include replies in the result. Default: false. */
  includeReplies?: boolean;
}

export interface ScrapedUserTweets {
  user: XUser;
  tweets: XTweet[];
  includes: { users: XUser[]; tweets: XTweet[] };
}

/**
 * Normalize a handle, numeric user ID, or full URL to a canonical X profile URL.
 * Used as actor input via `startUrls` so callers don't need to pre-resolve
 * numeric IDs (from data-export follow graphs) to handles.
 */
export function normalizeToXUrl(input: string): string {
  const trimmed = input.trim().replace(/^@/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `https://x.com/i/user/${trimmed}`;
  return `https://x.com/${trimmed}`;
}

/**
 * Parse a canonical X profile URL into a matcher for picking the primary user
 * out of the actor's returned author set. Returns the handle (lowercase) or
 * numeric ID, with a discriminator for which one we have.
 */
function parseXProfileUrl(url: string): { kind: "id"; id: string } | { kind: "handle"; handle: string } | null {
  const idMatch = url.match(/(?:x\.com|twitter\.com)\/i\/user\/(\d+)/i);
  if (idMatch) return { kind: "id", id: idMatch[1] };
  const handleMatch = url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/?(?:$|\?)/i);
  if (handleMatch && handleMatch[1] !== "i") return { kind: "handle", handle: handleMatch[1].toLowerCase() };
  return null;
}

/**
 * Scrape recent tweets for a single X user via Apify.
 *
 * Accepts a handle, numeric user ID, or full profile URL — all are normalized
 * to a URL and passed via the actor's `startUrls` input, so callers don't need
 * to resolve IDs to handles before scraping.
 *
 * Returns the same XTweet / XUser shape as the v2 client so callers can
 * swap data sources without changing downstream code.
 */
export async function scrapeUserTweets(
  userRef: string,
  opts: ScrapeUserTweetsOpts = {},
): Promise<ScrapedUserTweets> {
  const url = normalizeToXUrl(userRef);
  const matcher = parseXProfileUrl(url);
  const {
    startTime,
    endTime,
    maxItems = 50,
    includeRetweets = true,
    includeReplies = false,
  } = opts;

  const input: Record<string, unknown> = {
    startUrls: [{ url }],
    maxItems,
    sort: "Latest",
    includeRetweets,
    includeReplies,
  };
  if (startTime) input.start = startTime.slice(0, 10); // actor wants YYYY-MM-DD
  if (endTime) input.end = endTime.slice(0, 10);

  const items = await runActor<ApifyXItem>(ACTOR_ID, input);

  const userLookup = new Map<string, XUser>();
  const includedTweets: XTweet[] = [];
  const tweets: XTweet[] = [];
  let primaryUser: XUser | undefined;

  for (const item of items) {
    const normalized = normalizeTweet(item);
    if (!normalized) continue;

    // Track the author of each tweet
    if (item.author) {
      const u = normalizeUser(item.author);
      if (u) {
        userLookup.set(u.id, u);
        if (!primaryUser && matchesPrimary(u, matcher)) primaryUser = u;
      }
    }

    // Pull in referenced (retweeted/quoted) tweets
    const ref = item.retweetedStatus ?? item.quoted_status;
    if (ref) {
      const refTweet = normalizeTweet(ref);
      if (refTweet) includedTweets.push(refTweet);
      if (ref.author) {
        const refUser = normalizeUser(ref.author);
        if (refUser) userLookup.set(refUser.id, refUser);
      }
    }

    tweets.push(normalized);
  }

  // Fall back: any user we saw, then a stub from the input ref.
  if (!primaryUser) primaryUser = userLookup.values().next().value;
  if (!primaryUser) {
    const stub = matcher?.kind === "handle" ? matcher.handle : matcher?.kind === "id" ? matcher.id : userRef;
    primaryUser = { id: stub, name: stub, username: stub };
  }

  return {
    user: primaryUser,
    tweets,
    includes: {
      users: [...userLookup.values()],
      tweets: includedTweets,
    },
  };
}

function matchesPrimary(
  u: XUser,
  matcher: ReturnType<typeof parseXProfileUrl>,
): boolean {
  if (!matcher) return false;
  if (matcher.kind === "id") return u.id === matcher.id;
  return u.username.toLowerCase() === matcher.handle;
}

// --- Normalizers ---

function normalizeTweet(item: ApifyXItem): XTweet | null {
  const id = item.id_str ?? item.id;
  const text = item.full_text ?? item.text;
  const created = item.createdAt ?? item.created_at;
  const authorId = item.author?.id ?? item.author?.userName;
  if (!id || !text || !created || !authorId) return null;

  const referenced: XTweet["referenced_tweets"] = [];
  if (item.isRetweet && item.retweetedStatus?.id) {
    referenced.push({ type: "retweeted", id: String(item.retweetedStatus.id) });
  }
  if (item.isQuote && (item.quotedStatusId ?? item.quoted_status?.id)) {
    referenced.push({
      type: "quoted",
      id: String(item.quotedStatusId ?? item.quoted_status?.id),
    });
  }
  if (item.isReply && item.inReplyToUsername) {
    // We don't have the parent tweet ID from this actor; fabricate a marker.
    referenced.push({ type: "replied_to", id: `reply-to-${item.inReplyToUsername}` });
  }

  return {
    id: String(id),
    text: String(text),
    created_at: new Date(String(created)).toISOString(),
    author_id: String(authorId),
    public_metrics: {
      retweet_count: item.retweetCount ?? 0,
      reply_count: item.replyCount ?? 0,
      like_count: item.likeCount ?? 0,
      quote_count: item.quoteCount ?? 0,
    },
    referenced_tweets: referenced.length > 0 ? referenced : undefined,
    entities: item.entities
      ? {
          urls: (item.entities.urls ?? [])
            .filter((u) => u.expanded_url && u.display_url)
            .map((u) => ({
              expanded_url: u.expanded_url as string,
              display_url: u.display_url as string,
            })),
        }
      : undefined,
  };
}

function normalizeUser(author: NonNullable<ApifyXItem["author"]>): XUser | null {
  const id = author.id ?? author.userName;
  const username = author.userName;
  const name = author.name ?? author.userName;
  if (!id || !username || !name) return null;
  return {
    id: String(id),
    username,
    name,
    description: author.description,
    public_metrics: {
      followers_count: author.followers ?? 0,
      following_count: author.following ?? 0,
      tweet_count: author.statusesCount ?? 0,
    },
  };
}
