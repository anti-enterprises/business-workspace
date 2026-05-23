/**
 * Per-source seen-links cache for the SPA-index extraction path.
 *
 * SPA blogs surface the same set of post URLs every day on the index page
 * until those posts roll off. Without a cache, the extractor would refetch
 * already-seen posts on every run and waste Firecrawl budget. This module
 * persists `{url -> first_seen_at}` per source under the workspace's
 * `.seen-links/` directory, with a TTL-based rotation at write time.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const DEFAULT_WORKSPACE = "business-workspace";
const TTL_DAYS = 60;

export interface SeenLinkEntry {
  first_seen_at: string;
}

export interface SeenLinksCacheFile {
  source_id: string;
  last_run_at: string;
  links: Record<string, SeenLinkEntry>;
}

export interface SeenLinksCache {
  has(url: string): boolean;
  firstSeenAt(url: string): string | undefined;
  toJSON(): Record<string, SeenLinkEntry>;
}

function cacheDir(workspaceId: string): string {
  return join(homedir(), ".pulse", "workspaces", workspaceId, ".seen-links");
}

function cachePath(workspaceId: string, sourceId: string): string {
  return join(cacheDir(workspaceId), `${sourceId}.json`);
}

/**
 * Read the seen-links cache for a source. Returns an empty cache if the file
 * doesn't exist or is corrupted (cache-miss recovers automatically next run).
 */
export function readSeenLinksCache(
  sourceId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): SeenLinksCache {
  const path = cachePath(workspaceId, sourceId);
  let links: Record<string, SeenLinkEntry> = {};

  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as SeenLinksCacheFile;
      if (data && typeof data === "object" && data.links) {
        links = data.links;
      }
    } catch {
      // Corrupted cache — treat as empty.
    }
  }

  return {
    has: (url) => url in links,
    firstSeenAt: (url) => links[url]?.first_seen_at,
    toJSON: () => links,
  };
}

/**
 * Write the seen-links cache after a run, applying TTL rotation.
 *
 * - `currentLinks`: the full set of candidate post URLs observed on this run's
 *   index page. Each gets a `first_seen_at` of now if not already in the cache.
 * - Existing entries older than TTL_DAYS are dropped.
 * - Write is atomic via temp-file rename to avoid partial-write corruption.
 */
export function writeSeenLinksCache(
  sourceId: string,
  currentLinks: Iterable<string>,
  prior: SeenLinksCache,
  workspaceId: string = DEFAULT_WORKSPACE,
): void {
  const dir = cacheDir(workspaceId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const now = new Date();
  const cutoff = now.getTime() - TTL_DAYS * 86_400_000;
  const out: Record<string, SeenLinkEntry> = {};

  // Carry forward prior entries that are within TTL
  for (const [url, entry] of Object.entries(prior.toJSON())) {
    const ts = Date.parse(entry.first_seen_at);
    if (Number.isFinite(ts) && ts >= cutoff) {
      out[url] = entry;
    }
  }

  // Add current links (first_seen_at = existing prior or now)
  for (const url of currentLinks) {
    if (!(url in out)) {
      out[url] = { first_seen_at: now.toISOString() };
    }
  }

  const payload: SeenLinksCacheFile = {
    source_id: sourceId,
    last_run_at: now.toISOString(),
    links: out,
  };

  const path = cachePath(workspaceId, sourceId);
  const tmp = `${path}.tmp.${process.pid}`;
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
  renameSync(tmp, path);
}

/**
 * Determine which candidate links are NEW vs already cached.
 *
 * - Returns links not in the cache, or whose cached `first_seen_at` is older
 *   than `postAgeDays` (so we treat re-published / re-dated posts as new
 *   only when they fall outside the workspace's per-source post-age window).
 * - Capped at `maxPostsPerRun` to bound Firecrawl spend per source per run.
 */
export function selectNewLinks(
  candidates: string[],
  cache: SeenLinksCache,
  postAgeDays: number,
  maxPostsPerRun: number,
): string[] {
  const now = Date.now();
  const cutoff = now - postAgeDays * 86_400_000;
  const fresh: string[] = [];
  for (const url of candidates) {
    if (!cache.has(url)) {
      fresh.push(url);
    } else {
      const ts = Date.parse(cache.firstSeenAt(url) ?? "");
      if (Number.isFinite(ts) && ts < cutoff) {
        // Cache says we saw this >postAgeDays ago — likely re-published; rescrape.
        fresh.push(url);
      }
    }
    if (fresh.length >= maxPostsPerRun) break;
  }
  return fresh;
}
