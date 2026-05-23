import { getEnv } from "../config/env.js";
import { BaseApiClient } from "./base-client.js";

// --- Firecrawl API v2 Client ---

class FirecrawlClient extends BaseApiClient {
  protected readonly apiName = "firecrawl";
  protected readonly baseUrl = "https://api.firecrawl.dev/v2";
  protected readonly timeout = 30000;

  protected getHeaders() {
    const key = getEnv().FIRECRAWL_API_KEY;
    if (!key) throw new Error("FIRECRAWL_API_KEY not set");
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }

  protected countResults(data: unknown): number {
    if (typeof data !== "object" || data === null) return 0;
    const obj = data as Record<string, unknown>;
    return obj.success ? 1 : 0;
  }
}

const client = new FirecrawlClient();

// --- Types ---

export interface ScrapeResult {
  title: string;
  url: string;
  published: string;
  markdown: string;
  description: string;
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    links?: string[];
    metadata?: {
      title?: string;
      description?: string;
      publishedTimestamp?: string;
      sourceURL?: string;
      ogTitle?: string;
      ogDescription?: string;
    };
  };
}

export interface ScrapeWithLinksResult extends ScrapeResult {
  links: string[];
}

// --- API Functions ---

/**
 * Scrape a URL and return clean markdown content with metadata.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const data = await client.request<FirecrawlScrapeResponse>("scrape", {
    body: {
      url,
      formats: ["markdown"],
    },
  });

  if (!data.success || !data.data) {
    throw new Error(`Firecrawl scrape failed for ${url}`);
  }

  const meta = data.data.metadata ?? {};

  return {
    title: meta.title ?? meta.ogTitle ?? "",
    url: meta.sourceURL ?? url,
    published: meta.publishedTimestamp ?? "",
    markdown: data.data.markdown ?? "",
    description: (meta.description ?? meta.ogDescription ?? "").slice(0, 500),
  };
}

/**
 * Scrape a URL and additionally return the list of outbound links found on
 * the page. Used by the SPA-index extraction path: the index page is scraped
 * with formats=['markdown','links'] so the extractor can diff candidate post
 * URLs against a per-source seen-links cache.
 */
export async function scrapeUrlWithLinks(url: string): Promise<ScrapeWithLinksResult> {
  const data = await client.request<FirecrawlScrapeResponse>("scrape", {
    body: {
      url,
      formats: ["markdown", "links"],
    },
  });

  if (!data.success || !data.data) {
    throw new Error(`Firecrawl scrape failed for ${url}`);
  }

  const meta = data.data.metadata ?? {};

  return {
    title: meta.title ?? meta.ogTitle ?? "",
    url: meta.sourceURL ?? url,
    published: meta.publishedTimestamp ?? "",
    markdown: data.data.markdown ?? "",
    description: (meta.description ?? meta.ogDescription ?? "").slice(0, 500),
    links: Array.isArray(data.data.links) ? data.data.links : [],
  };
}
