import Exa from "exa-js";
import { getEnv } from "../config/env.js";
import { logToolUsage } from "../db/tool-usage.js";

let _client: Exa | null = null;

function getClient(): Exa {
  if (!_client) {
    const key = getEnv().EXA_API_KEY;
    if (!key) throw new Error("EXA_API_KEY not set");
    _client = new Exa(key);
  }
  return _client;
}

// --- Logging wrapper ---

async function withLogging<T>(
  operation: string,
  fn: () => Promise<T>,
  campaignId?: string,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const resultsCount =
      typeof result === "object" && result !== null && "results" in result
        ? Array.isArray((result as Record<string, unknown>).results)
          ? ((result as Record<string, unknown>).results as unknown[]).length
          : 0
        : 0;
    try {
      await logToolUsage({
        api_name: "exa",
        operation,
        campaign_id: campaignId,
        results_count: resultsCount,
        duration_ms: Date.now() - start,
        success: true,
      });
    } catch {
      // Don't fail API call if logging fails
    }
    return result;
  } catch (err) {
    try {
      await logToolUsage({
        api_name: "exa",
        operation,
        campaign_id: campaignId,
        results_count: 0,
        duration_ms: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // Don't fail API call if logging fails
    }
    throw err;
  }
}

// --- Search ---

export type SearchType = "auto" | "fast" | "instant" | "deep-lite" | "deep" | "deep-reasoning";

export interface SearchParams {
  query: string;
  num_results?: number;
  search_type?: SearchType;
  start_published_date?: string;
  end_published_date?: string;
  include_domains?: string[];
  exclude_domains?: string[];
  include_text?: string[];
  category?: string;
  output_schema?: Record<string, unknown>;
  campaignId?: string;
}

export async function search(params: SearchParams): Promise<Record<string, unknown>[]> {
  const options: Record<string, unknown> = {
    numResults: params.num_results ?? 20,
    type: params.search_type ?? "auto",
  };

  if (params.start_published_date) options.startPublishedDate = params.start_published_date;
  if (params.end_published_date) options.endPublishedDate = params.end_published_date;
  if (params.include_domains) options.includeDomains = params.include_domains;
  if (params.exclude_domains) options.excludeDomains = params.exclude_domains;
  if (params.include_text) options.includeText = params.include_text;
  if (params.category) options.category = params.category;
  if (params.output_schema) options.outputSchema = params.output_schema;

  const data = await withLogging(
    "search",
    () => getClient().search(params.query, options),
    params.campaignId,
  );

  return (data.results ?? []) as unknown as Record<string, unknown>[];
}

// --- Search and Contents ---

export interface SearchAndContentsParams {
  query: string;
  num_results?: number;
  search_type?: SearchType;
  text?: boolean | { maxCharacters?: number };
  highlights?: boolean | { maxCharacters?: number; query?: string };
  summary?: boolean | { query?: string };
  start_published_date?: string;
  end_published_date?: string;
  category?: string;
  output_schema?: Record<string, unknown>;
  campaignId?: string;
}

export async function searchAndContents(
  params: SearchAndContentsParams,
): Promise<Record<string, unknown>[]> {
  const options: Record<string, unknown> = {
    numResults: params.num_results ?? 10,
    type: params.search_type ?? "auto",
  };

  if (params.start_published_date) options.startPublishedDate = params.start_published_date;
  if (params.end_published_date) options.endPublishedDate = params.end_published_date;
  if (params.category) options.category = params.category;
  if (params.output_schema) options.outputSchema = params.output_schema;

  // Content configuration
  if (params.text !== undefined) {
    options.text = params.text === true ? { maxCharacters: 20000 } : params.text;
  }
  if (params.highlights !== undefined) {
    options.highlights =
      params.highlights === true ? { maxCharacters: 4000 } : params.highlights;
  }
  if (params.summary !== undefined) {
    options.summary = params.summary;
  }

  const data = await withLogging(
    "searchAndContents",
    () => getClient().searchAndContents(params.query, options),
    params.campaignId,
  );

  return (data.results ?? []) as unknown as Record<string, unknown>[];
}

// --- Get Contents ---

export interface GetContentsParams {
  urls: string[];
  text?: boolean | { maxCharacters?: number };
  highlights?: boolean | { maxCharacters?: number; query?: string };
  summary?: boolean | { query?: string };
  campaignId?: string;
}

export async function getContents(
  params: GetContentsParams,
): Promise<Record<string, unknown>[]> {
  const options: Record<string, unknown> = {};

  if (params.text !== undefined) {
    options.text = params.text === true ? { maxCharacters: 20000 } : params.text;
  }
  if (params.highlights !== undefined) {
    options.highlights =
      params.highlights === true ? { maxCharacters: 4000 } : params.highlights;
  }
  if (params.summary !== undefined) {
    options.summary = params.summary;
  }

  const data = await withLogging(
    "getContents",
    () => getClient().getContents(params.urls, options),
    params.campaignId,
  );

  return (data.results ?? []) as unknown as Record<string, unknown>[];
}

// --- Find Similar ---

export async function findSimilar(
  url: string,
  numResults = 10,
  excludeSourceDomain = true,
  campaignId?: string,
): Promise<Record<string, unknown>[]> {
  const data = await withLogging(
    "findSimilar",
    () => getClient().findSimilar(url, { numResults, excludeSourceDomain }),
    campaignId,
  );
  return (data.results ?? []) as unknown as Record<string, unknown>[];
}

// --- Signal helpers ---

export async function findRecentlyFunded(opts: {
  vertical?: string;
  funding_stage?: string;
  days_back?: number;
  num_results?: number;
  campaignId?: string;
} = {}): Promise<Record<string, unknown>[]> {
  const daysBack = opts.days_back ?? 90;
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];
  const stageText = opts.funding_stage ? ` ${opts.funding_stage}` : "";
  const query = `${opts.vertical ?? "B2B SaaS"} company raised${stageText} funding round`;

  return search({
    query,
    num_results: opts.num_results ?? 20,
    start_published_date: startDate,
    category: "news",
    campaignId: opts.campaignId,
  });
}

export async function findLeadershipChanges(opts: {
  vertical?: string;
  roles?: string[];
  days_back?: number;
  num_results?: number;
  campaignId?: string;
} = {}): Promise<Record<string, unknown>[]> {
  const daysBack = opts.days_back ?? 60;
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];
  const roleText = opts.roles?.join(" or ") ?? "CEO or VP or CRO";
  const query = `${opts.vertical ?? "B2B SaaS"} company hired new ${roleText}`;

  return search({
    query,
    num_results: opts.num_results ?? 20,
    start_published_date: startDate,
    category: "news",
    campaignId: opts.campaignId,
  });
}

export async function findGrowthSignals(opts: {
  vertical?: string;
  signal_keywords?: string[];
  days_back?: number;
  num_results?: number;
  campaignId?: string;
} = {}): Promise<Record<string, unknown>[]> {
  const daysBack = opts.days_back ?? 90;
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];
  const keywords = opts.signal_keywords?.join(" OR ") ?? "expanding OR launched OR growth";
  const query = `${opts.vertical ?? "B2B SaaS"} company ${keywords}`;

  return search({
    query,
    num_results: opts.num_results ?? 20,
    start_published_date: startDate,
    campaignId: opts.campaignId,
  });
}

// --- Normalizer ---

export interface NormalizedSearchResult {
  title: string;
  url: string;
  domain: string;
  published_date: string;
  text: string;
  highlights: string[];
  summary: string;
  score: number;
}

export function normalizeSearchResult(result: Record<string, unknown>): NormalizedSearchResult {
  const url = (result.url as string) ?? "";
  let domain = "";
  try {
    domain = new URL(url).hostname.replace("www.", "");
  } catch {
    // invalid URL
  }

  return {
    title: (result.title as string) ?? "",
    url,
    domain,
    published_date: (result.publishedDate as string) ?? "",
    text: (result.text as string) ?? "",
    highlights: (result.highlights as string[]) ?? [],
    summary: (result.summary as string) ?? "",
    score: (result.score as number) ?? 0,
  };
}
