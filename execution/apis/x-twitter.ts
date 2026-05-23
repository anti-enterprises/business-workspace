import { getEnv } from "../config/env.js";
import { BaseApiClient } from "./base-client.js";

// --- X/Twitter API v2 Client ---

class XTwitterClient extends BaseApiClient {
  protected readonly apiName = "x_twitter";
  protected readonly baseUrl = "https://api.x.com/2";
  protected readonly timeout = 15000;

  protected getHeaders() {
    const token = getEnv().X_API_BEARER_TOKEN;
    if (!token) throw new Error("X_API_BEARER_TOKEN not set");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  protected countResults(data: unknown): number {
    if (typeof data !== "object" || data === null) return 0;
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data.length;
    return 0;
  }
}

const client = new XTwitterClient();

// --- Types ---

export interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
}

export interface XTweet {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  referenced_tweets?: Array<{
    type: "retweeted" | "quoted" | "replied_to";
    id: string;
  }>;
  entities?: {
    urls?: Array<{ expanded_url: string; display_url: string }>;
  };
}

export interface TweetOptions {
  startTime?: string;
  endTime?: string;
  maxResults?: number;
  paginationToken?: string;
  excludeRetweets?: boolean;
  excludeReplies?: boolean;
}

interface XUserResponse {
  data?: XUser;
}

interface XListResponse<T> {
  data?: T[];
  meta?: { next_token?: string; result_count?: number };
  includes?: {
    users?: XUser[];
    tweets?: XTweet[];
  };
}

// --- API Functions ---

/**
 * Look up a user by username.
 */
export async function getUserByUsername(username: string): Promise<XUser> {
  const clean = username.replace(/^@/, "");
  const data = await client.request<XUserResponse>(`users/by/username/${clean}`, {
    method: "GET",
    params: {
      "user.fields": "id,name,username,description,public_metrics",
    },
  });

  if (!data.data) throw new Error(`X user not found: @${clean}`);
  return data.data;
}

/**
 * Get a single page of accounts a user follows.
 */
export async function getFollowing(
  userId: string,
  maxResults = 100,
  paginationToken?: string,
): Promise<{ users: XUser[]; nextToken?: string }> {
  const params: Record<string, string | number | boolean> = {
    "user.fields": "id,name,username,description,public_metrics",
    max_results: maxResults,
  };
  if (paginationToken) params.pagination_token = paginationToken;

  const data = await client.request<XListResponse<XUser>>(`users/${userId}/following`, {
    method: "GET",
    params,
  });

  return {
    users: data.data ?? [],
    nextToken: data.meta?.next_token,
  };
}

/**
 * Fetch all accounts a user follows (paginated).
 */
export async function getAllFollowing(userId: string): Promise<XUser[]> {
  const all: XUser[] = [];
  let nextToken: string | undefined;

  do {
    const page = await getFollowing(userId, 100, nextToken);
    all.push(...page.users);
    nextToken = page.nextToken;
    if (nextToken) {
      console.error(`  Fetched ${all.length} following so far...`);
    }
  } while (nextToken);

  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get recent tweets from a user, with repost/quote/reply classification.
 */
export async function getUserTweets(
  userId: string,
  options: TweetOptions = {},
): Promise<{ tweets: XTweet[]; includes?: { users?: XUser[]; tweets?: XTweet[] }; nextToken?: string }> {
  const params: Record<string, string | number | boolean> = {
    "tweet.fields": "created_at,referenced_tweets,public_metrics,entities,author_id",
    "expansions": "referenced_tweets.id,author_id",
    "user.fields": "name,username",
    max_results: options.maxResults ?? 20,
  };

  if (options.startTime) params.start_time = options.startTime;
  if (options.endTime) params.end_time = options.endTime;
  if (options.paginationToken) params.pagination_token = options.paginationToken;

  const exclude: string[] = [];
  if (options.excludeRetweets) exclude.push("retweets");
  if (options.excludeReplies) exclude.push("replies");
  if (exclude.length > 0) params.exclude = exclude.join(",");

  const data = await client.request<XListResponse<XTweet>>(`users/${userId}/tweets`, {
    method: "GET",
    params,
  });

  return {
    tweets: data.data ?? [],
    includes: data.includes,
    nextToken: data.meta?.next_token,
  };
}

/**
 * Check if a tweet is a repost (retweet).
 */
export function isRepost(tweet: XTweet): boolean {
  return tweet.referenced_tweets?.some((r) => r.type === "retweeted") ?? false;
}

/**
 * Check if a tweet is a quote tweet.
 */
export function isQuote(tweet: XTweet): boolean {
  return tweet.referenced_tweets?.some((r) => r.type === "quoted") ?? false;
}
