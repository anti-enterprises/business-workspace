/**
 * Lightweight RSS/Atom feed fetcher + parser.
 * No external dependencies — uses native fetch + string parsing.
 */

export interface FeedEntry {
  title: string;
  link: string;
  published: string;
  description: string;
}

export interface FeedResult {
  title: string;
  entries: FeedEntry[];
}

const FETCH_TIMEOUT = 10000;

// --- XML helpers ---

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i");
  const match = xml.match(regex);
  return match?.[1]?.trim() ?? "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  return xml.match(regex)?.[1] ?? "";
}

function splitItems(xml: string, tag: string): string[] {
  const items: string[] = [];
  const regex = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    items.push(match[0]);
  }
  return items;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return dateStr;
  }
}

// --- Feed parsing ---

function parseRss2(xml: string): FeedResult {
  const channelTitle = extractTag(xml, "title");
  const items = splitItems(xml, "item");

  const entries: FeedEntry[] = items.map((item) => {
    const link = extractTag(item, "link") || extractTag(item, "guid");
    const description = extractTag(item, "description") || extractTag(item, "content:encoded");
    return {
      title: stripHtml(extractTag(item, "title")),
      link: link.trim(),
      published: parseDate(extractTag(item, "pubDate")),
      description: stripHtml(description).slice(0, 500),
    };
  });

  return { title: stripHtml(channelTitle), entries };
}

function parseAtom(xml: string): FeedResult {
  const feedTitle = extractTag(xml, "title");
  const items = splitItems(xml, "entry");

  const entries: FeedEntry[] = items.map((entry) => {
    const link = extractAttr(entry, "link", "href") || extractTag(entry, "link");
    const description = extractTag(entry, "summary") || extractTag(entry, "content");
    return {
      title: stripHtml(extractTag(entry, "title")),
      link: link.trim(),
      published: parseDate(extractTag(entry, "published") || extractTag(entry, "updated")),
      description: stripHtml(description).slice(0, 500),
    };
  });

  return { title: stripHtml(feedTitle), entries };
}

// --- Public API ---

/**
 * Fetch and parse an RSS or Atom feed.
 */
export async function fetchFeed(feedUrl: string): Promise<FeedResult> {
  const res = await fetch(feedUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { "User-Agent": "PulseBot/1.0 (RSS reader)" },
  });

  if (!res.ok) {
    throw new Error(`Feed fetch failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();

  if (xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"")) {
    return parseAtom(xml);
  }

  return parseRss2(xml);
}

/**
 * Fetch a feed and filter to entries published within a time window.
 */
export async function fetchRecentEntries(
  feedUrl: string,
  after: Date,
): Promise<FeedEntry[]> {
  const result = await fetchFeed(feedUrl);
  return result.entries.filter((e) => {
    if (!e.published) return true;
    return new Date(e.published) >= after;
  });
}

// --- Feed URL discovery ---

const COMMON_FEED_PATHS = [
  "/feed",
  "/rss",
  "/rss.xml",
  "/atom.xml",
  "/feed.xml",
  "/index.xml",
  "/blog/feed",
  "/blog/rss",
  "/blog/rss.xml",
  "/blog/atom.xml",
  "/feed/rss",
  "/feed/atom",
];

/**
 * Attempt to discover the RSS/Atom feed URL for a blog.
 * Tries HTML link discovery then common feed paths.
 */
export async function discoverFeedUrl(blogUrl: string): Promise<string | null> {
  const base = blogUrl.replace(/\/+$/, "");

  // First, try to find <link rel="alternate"> in the HTML
  try {
    const res = await fetch(base, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { "User-Agent": "PulseBot/1.0 (RSS discovery)" },
    });
    if (res.ok) {
      const html = await res.text();
      const rssMatch = html.match(/<link[^>]*type="application\/rss\+xml"[^>]*href="([^"]+)"/i)
        ?? html.match(/<link[^>]*href="([^"]+)"[^>]*type="application\/rss\+xml"/i);
      const atomMatch = html.match(/<link[^>]*type="application\/atom\+xml"[^>]*href="([^"]+)"/i)
        ?? html.match(/<link[^>]*href="([^"]+)"[^>]*type="application\/atom\+xml"/i);

      const discovered = rssMatch?.[1] ?? atomMatch?.[1];
      if (discovered) {
        if (discovered.startsWith("http")) return discovered;
        const url = new URL(discovered, base);
        return url.href;
      }
    }
  } catch {
    // HTML fetch failed, try common paths
  }

  // Try common feed paths
  for (const path of COMMON_FEED_PATHS) {
    const candidate = `${base}${path}`;
    try {
      const res = await fetch(candidate, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "PulseBot/1.0 (RSS discovery)" },
      });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom") || ct.includes("text/xml")) {
          return candidate;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}
