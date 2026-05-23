import { getEnv } from "../config/env.js";
import { BaseApiClient } from "./base-client.js";

// --- YouTube Data API v3 Client ---

class YouTubeClient extends BaseApiClient {
  protected readonly apiName = "youtube";
  protected readonly baseUrl = "https://www.googleapis.com/youtube/v3";
  protected readonly timeout = 15000;

  protected getHeaders() {
    return { "Content-Type": "application/json" };
  }

  /** Override to append API key as query param (YouTube uses key auth, not header auth). */
  async request<T = Record<string, unknown>>(
    endpoint: string,
    options: { method?: "GET" | "POST"; params?: Record<string, string | number | boolean>; body?: Record<string, unknown>; campaignId?: string } = {},
  ): Promise<T> {
    const key = getEnv().YOUTUBE_API_KEY;
    if (!key) throw new Error("YOUTUBE_API_KEY not set");
    const params = { ...options.params, key };
    return super.request<T>(endpoint, { ...options, method: "GET", params });
  }

  protected countResults(data: unknown): number {
    if (typeof data !== "object" || data === null) return 0;
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items.length;
    return 0;
  }
}

const client = new YouTubeClient();

// --- Types ---

export interface ChannelInfo {
  channelId: string;
  title: string;
  description: string;
  customUrl: string;
  uploadsPlaylistId: string;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
}

interface YouTubeChannelResponse {
  items?: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      customUrl: string;
    };
    contentDetails: {
      relatedPlaylists: { uploads: string };
    };
  }>;
}

interface YouTubePlaylistResponse {
  nextPageToken?: string;
  items?: Array<{
    snippet: {
      publishedAt: string;
      channelId: string;
      title: string;
      description: string;
      channelTitle: string;
      thumbnails: Record<string, { url: string }>;
      resourceId: { videoId: string };
    };
  }>;
}

// --- API Functions ---

/**
 * Resolve a channel handle (@AlexHormozi) to a channel ID and metadata.
 */
export async function resolveChannel(handle: string): Promise<ChannelInfo> {
  const cleanHandle = handle.replace(/^@/, "").replace(/^https?:\/\/(www\.)?youtube\.com\/@?/, "");
  const data = await client.request<YouTubeChannelResponse>("channels", {
    params: {
      part: "snippet,contentDetails",
      forHandle: cleanHandle,
    },
  });

  const item = data.items?.[0];
  if (!item) throw new Error(`Channel not found for handle: ${handle}`);

  return {
    channelId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    customUrl: item.snippet.customUrl,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

/**
 * Fetch recent uploads from a channel's uploads playlist.
 * The uploads playlist ID is the channel ID with "UC" replaced by "UU".
 */
export async function getRecentUploads(
  channelId: string,
  maxResults = 5,
): Promise<VideoInfo[]> {
  // Convert channel ID to uploads playlist ID: UC... -> UU...
  const uploadsPlaylistId = "UU" + channelId.slice(2);

  const data = await client.request<YouTubePlaylistResponse>("playlistItems", {
    params: {
      part: "snippet",
      playlistId: uploadsPlaylistId,
      maxResults,
    },
  });

  return (data.items ?? []).map((item) => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl: item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.default?.url ?? "",
  }));
}

/**
 * Fetch recent uploads published within a time window.
 * Filters client-side since playlistItems doesn't support date filtering.
 */
export async function getUploadsAfter(
  channelId: string,
  after: Date,
  maxFetch = 20,
): Promise<VideoInfo[]> {
  const videos = await getRecentUploads(channelId, maxFetch);
  return videos.filter((v) => new Date(v.publishedAt) >= after);
}
