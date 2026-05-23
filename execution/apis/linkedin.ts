/**
 * LinkedIn creator-watch via Apify (apimaestro/linkedin-profile-posts).
 *
 * Fetches recent posts from a public LinkedIn profile or company page by
 * URL. Used to watch specific creators (competitors, influencers) instead
 * of authenticating to Jose's feed.
 *
 * Actor: https://apify.com/apimaestro/linkedin-profile-posts
 * Cost (2026-05): ~$5 / 1K posts.
 */

import { runActor } from "./apify.js";

const ACTOR_ID = "apimaestro~linkedin-profile-posts";

// --- Raw item shape (subset) ---

interface ApifyLinkedInItem {
  urn?: string;
  posted_at?: { date?: string; relative?: string };
  text?: string;
  url?: string;
  post_type?: string;
  author?: {
    public_id?: string;
    profile_url?: string;
    first_name?: string;
    last_name?: string;
    headline?: string;
    type?: string; // "person" | "company"
  };
  stats?: {
    total_reactions?: number;
    like?: number;
    appreciation?: number;
    empathy?: number;
    interest?: number;
    praise?: number;
    funny?: number;
    comments?: number;
    reposts?: number;
  };
  media?: {
    type?: string;
    url?: string;
    thumbnail?: string;
  };
  reposted_post?: {
    urn?: string;
    text?: string;
    author?: ApifyLinkedInItem["author"];
  };
  error?: string;
  [key: string]: unknown;
}

// --- Normalized shape ---

export interface LinkedInPost {
  id: string; // urn
  url: string;
  postedAt: string; // ISO 8601
  text: string;
  postType: string;
  reactions: number;
  comments: number;
  reposts: number;
  authorProfileUrl: string;
  authorName: string;
  authorHeadline: string | null;
  isRepost: boolean;
  repostedFromName: string | null;
  repostedText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
}

// --- Public API ---

export interface ScrapeLinkedInProfileOpts {
  /** Cap on posts per profile. Default 20. */
  resultsLimit?: number;
}

/**
 * Scrape posts for one LinkedIn profile/company URL. Returns normalized
 * post records suitable for the daily aggregator.
 */
export async function scrapeLinkedInProfile(
  profileUrl: string,
  opts: ScrapeLinkedInProfileOpts = {},
): Promise<{ posts: LinkedInPost[]; error?: string }> {
  const { resultsLimit = 20 } = opts;
  const input: Record<string, unknown> = {
    profileUrls: [profileUrl],
    maxPosts: resultsLimit,
    timeWindow: "Past 24 hours",
  };

  let items: ApifyLinkedInItem[];
  try {
    items = await runActor<ApifyLinkedInItem>(ACTOR_ID, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { posts: [], error: msg };
  }

  const posts: LinkedInPost[] = [];
  for (const item of items) {
    if (item.error) continue;
    const normalized = normalizePost(item);
    if (normalized) posts.push(normalized);
  }
  return { posts };
}

export async function scrapeLinkedInProfiles(
  profileUrls: string[],
  opts: ScrapeLinkedInProfileOpts = {},
): Promise<Map<string, { posts: LinkedInPost[]; error?: string }>> {
  const results = new Map<string, { posts: LinkedInPost[]; error?: string }>();
  for (const url of profileUrls) {
    results.set(url, await scrapeLinkedInProfile(url, opts));
  }
  return results;
}

// --- Helpers ---

function normalizePost(item: ApifyLinkedInItem): LinkedInPost | null {
  const id = item.urn;
  const url = item.url;
  const text = item.text ?? "";
  const posted = item.posted_at?.date;
  const author = item.author;
  if (!id || !url || !posted || !author?.profile_url) return null;

  const authorName = [author.first_name, author.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  const repostedFromName = item.reposted_post?.author
    ? [item.reposted_post.author.first_name, item.reposted_post.author.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || null
    : null;

  return {
    id,
    url,
    postedAt: new Date(posted).toISOString(),
    text,
    postType: item.post_type ?? "post",
    reactions: item.stats?.total_reactions ?? 0,
    comments: item.stats?.comments ?? 0,
    reposts: item.stats?.reposts ?? 0,
    authorProfileUrl: author.profile_url,
    authorName: authorName || (author.public_id ?? ""),
    authorHeadline: author.headline ?? null,
    isRepost: Boolean(item.reposted_post),
    repostedFromName,
    repostedText: item.reposted_post?.text ?? null,
    mediaUrl: item.media?.url ?? null,
    mediaType: item.media?.type ?? null,
  };
}
