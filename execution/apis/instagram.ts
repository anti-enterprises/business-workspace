/**
 * Instagram scraper via Apify actor (apify/instagram-profile-scraper).
 *
 * Fetches recent posts + reels for a public profile by URL. No IG auth
 * required on our side — the actor handles login + proxy rotation.
 *
 * Actor: https://apify.com/apify/instagram-profile-scraper
 * Cost (2026-05): ~$2.30 / 1K results.
 */

import { runActor } from "./apify.js";

const ACTOR_ID = "apify~instagram-profile-scraper";

// --- Raw item shape (subset of fields we use) ---

/**
 * Per-username profile envelope returned by apify/instagram-profile-scraper.
 * Posts are nested in `latestPosts`.
 */
interface ApifyIgProfileEnvelope {
  inputUrl?: string;
  id?: string;
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  verified?: boolean;
  private?: boolean;
  isBusinessAccount?: boolean;
  latestPosts?: ApifyIgPost[];
  error?: string;
  errorDescription?: string;
  [key: string]: unknown;
}

interface ApifyIgPost {
  id?: string;
  type?: string; // "Image" | "Video" | "Sidecar"
  shortCode?: string;
  caption?: string;
  hashtags?: string[];
  mentions?: string[];
  url?: string;
  commentsCount?: number;
  likesCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  timestamp?: string;
  productType?: string; // "feed" | "clips" (reels)
  isPinned?: boolean;
  isCommentsDisabled?: boolean;
  isSponsored?: boolean;
  displayUrl?: string;
  videoUrl?: string;
  videoDuration?: number;
  alt?: string;
  ownerUsername?: string;
  ownerId?: string;
  [key: string]: unknown;
}

// --- Normalized shape ---

export interface IgPost {
  id: string;
  shortCode: string;
  url: string;
  type: "image" | "video" | "carousel" | "reel" | "other";
  caption: string;
  hashtags: string[];
  mentions: string[];
  likes: number;
  comments: number;
  videoViews: number | null;
  timestamp: string;
  isPinned: boolean;
  isSponsored: boolean;
  mediaUrl: string | null;
  alt: string | null;
  videoDurationSec: number | null;
}

export interface IgProfile {
  username: string;
  fullName: string;
  userId: string;
}

// --- Public API ---

export interface ScrapeIgProfileOpts {
  /** Cap on posts per profile. Default 30. */
  resultsLimit?: number;
  /** What to scrape: "posts" | "reels" | "stories". Default "posts" + reels mixed. */
  resultsType?: "posts" | "reels";
}

/**
 * Scrape recent posts for a list of Instagram profile URLs in one actor run.
 * Returns one entry per source URL; an entry has the profile metadata + posts.
 */
export async function scrapeIgProfiles(
  profileUrls: string[],
  opts: ScrapeIgProfileOpts = {},
): Promise<Map<string, { profile: IgProfile | null; posts: IgPost[]; error?: string }>> {
  const { resultsLimit = 30 } = opts;
  const out = new Map<string, { profile: IgProfile | null; posts: IgPost[]; error?: string }>();
  if (profileUrls.length === 0) return out;

  // Normalize inputs and seed map so every requested URL has an entry
  const cleaned = profileUrls.map((u) => u.replace(/\/?$/, "/"));
  const usernames: string[] = [];
  for (const u of cleaned) {
    out.set(u, { profile: null, posts: [] });
    const m = u.match(/instagram\.com\/([A-Za-z0-9_.]+)\/?/);
    if (m) usernames.push(m[1]);
  }

  const input: Record<string, unknown> = {
    usernames,
    resultsLimit,
  };

  const envelopes = await runActor<ApifyIgProfileEnvelope>(ACTOR_ID, input);

  for (const env of envelopes) {
    const sourceUrl = matchEnvelopeToSourceUrl(env, cleaned);
    if (!sourceUrl) continue;
    const bucket = out.get(sourceUrl)!;

    if (env.error) {
      bucket.error = env.errorDescription ?? env.error;
      continue;
    }

    if (!bucket.profile && env.username) {
      bucket.profile = {
        username: env.username,
        fullName: env.fullName ?? env.username,
        userId: env.id ?? "",
      };
    }

    for (const post of env.latestPosts ?? []) {
      const normalized = normalizePost(post);
      if (normalized) bucket.posts.push(normalized);
    }
  }

  return out;
}

// --- Helpers ---

function matchEnvelopeToSourceUrl(
  env: ApifyIgProfileEnvelope,
  sourceUrls: string[],
): string | null {
  if (env.inputUrl) {
    const wanted = env.inputUrl.replace(/\/?$/, "/");
    const direct = sourceUrls.find((u) => u === wanted);
    if (direct) return direct;
  }
  if (env.username) {
    const handle = env.username.toLowerCase();
    const byHandle = sourceUrls.find((u) =>
      u.toLowerCase().includes(`instagram.com/${handle}/`),
    );
    if (byHandle) return byHandle;
  }
  return null;
}

function normalizePost(post: ApifyIgPost): IgPost | null {
  const id = post.id;
  const shortCode = post.shortCode;
  const url = post.url ?? (shortCode ? `https://www.instagram.com/p/${shortCode}/` : undefined);
  const timestamp = post.timestamp;
  if (!id || !shortCode || !url || !timestamp) return null;

  let type: IgPost["type"] = "other";
  if (post.productType === "clips") type = "reel";
  else if (post.type === "Image") type = "image";
  else if (post.type === "Video") type = "video";
  else if (post.type === "Sidecar") type = "carousel";

  return {
    id: String(id),
    shortCode,
    url,
    type,
    caption: post.caption ?? "",
    hashtags: post.hashtags ?? [],
    mentions: post.mentions ?? [],
    likes: post.likesCount ?? 0,
    comments: post.commentsCount ?? 0,
    videoViews: post.videoPlayCount ?? post.videoViewCount ?? null,
    timestamp: new Date(timestamp).toISOString(),
    isPinned: post.isPinned ?? false,
    isSponsored: post.isSponsored ?? false,
    mediaUrl: post.videoUrl ?? post.displayUrl ?? null,
    alt: post.alt ?? null,
    videoDurationSec: post.videoDuration ?? null,
  };
}
