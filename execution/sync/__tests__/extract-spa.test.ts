import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

// Mock Firecrawl + env BEFORE importing the modules under test
vi.mock("../../apis/firecrawl.js", () => ({
  scrapeUrl: vi.fn(),
  scrapeUrlWithLinks: vi.fn(),
}));
vi.mock("../../config/env.js", () => ({
  hasApiKey: () => true,
  getEnv: () => ({ FIRECRAWL_API_KEY: "test-key" }),
}));

import { scrapeUrl, scrapeUrlWithLinks } from "../../apis/firecrawl.js";
import { extractSpaIndex, type RssSource } from "../extract-rss.js";
import {
  readSeenLinksCache,
  writeSeenLinksCache,
  selectNewLinks,
} from "../seen-links-cache.js";

const TEST_WS = `test-ws-${Date.now()}`;
const TEST_WS_DIR = join(homedir(), ".pulse", "workspaces", TEST_WS);

function fakeSource(overrides: Partial<RssSource> = {}): RssSource {
  return {
    id: "src-rss-test",
    label: "Test Source",
    url: "https://example.com/news",
    feedUrl: null,
    strategic_role: "industry_signal",
    spaExtraction: {
      enabled: true,
      max_posts_per_run: 10,
      post_age_days: 14,
    },
    ...overrides,
  };
}

beforeEach(() => {
  // Reset ALL mock state including mockImplementation closures (mockResolvedValueOnce
  // queue, custom impls). vi.clearAllMocks() only clears call history; impls would leak.
  vi.resetAllMocks();
  if (existsSync(TEST_WS_DIR)) rmSync(TEST_WS_DIR, { recursive: true, force: true });
});

describe("seen-links-cache", () => {
  it("round-trips written entries", () => {
    const empty = readSeenLinksCache("src-test", TEST_WS);
    expect(empty.has("https://x.com/post-1")).toBe(false);

    writeSeenLinksCache(
      "src-test",
      ["https://x.com/post-1", "https://x.com/post-2"],
      empty,
      TEST_WS,
    );

    const reloaded = readSeenLinksCache("src-test", TEST_WS);
    expect(reloaded.has("https://x.com/post-1")).toBe(true);
    expect(reloaded.has("https://x.com/post-2")).toBe(true);
    expect(reloaded.has("https://x.com/post-3")).toBe(false);
  });

  it("rotates entries older than the TTL", () => {
    // Author a corrupted-but-loadable cache where one entry is ancient
    const path = join(homedir(), ".pulse", "workspaces", TEST_WS, ".seen-links", "src-old.json");
    const fs = require("fs");
    fs.mkdirSync(join(homedir(), ".pulse", "workspaces", TEST_WS, ".seen-links"), { recursive: true });
    fs.writeFileSync(path, JSON.stringify({
      source_id: "src-old",
      last_run_at: "2020-01-01T00:00:00Z",
      links: {
        "https://x.com/ancient": { first_seen_at: "2020-01-01T00:00:00Z" },
        "https://x.com/recent": { first_seen_at: new Date().toISOString() },
      },
    }));

    const cache = readSeenLinksCache("src-old", TEST_WS);
    writeSeenLinksCache("src-old", ["https://x.com/recent", "https://x.com/new"], cache, TEST_WS);

    const reloaded = readSeenLinksCache("src-old", TEST_WS);
    expect(reloaded.has("https://x.com/ancient")).toBe(false); // dropped via TTL
    expect(reloaded.has("https://x.com/recent")).toBe(true);
    expect(reloaded.has("https://x.com/new")).toBe(true);
  });

  it("selectNewLinks excludes already-seen and respects max_posts_per_run", () => {
    const empty = readSeenLinksCache("src-sel", TEST_WS);
    writeSeenLinksCache(
      "src-sel",
      ["https://x.com/seen-1", "https://x.com/seen-2"],
      empty,
      TEST_WS,
    );
    const cache = readSeenLinksCache("src-sel", TEST_WS);

    const fresh = selectNewLinks(
      [
        "https://x.com/seen-1",
        "https://x.com/seen-2",
        "https://x.com/new-1",
        "https://x.com/new-2",
        "https://x.com/new-3",
      ],
      cache,
      14,
      2, // cap
    );
    expect(fresh).toEqual(["https://x.com/new-1", "https://x.com/new-2"]);
  });
});

describe("extractSpaIndex", () => {
  it("returns null when spa_extraction is disabled", async () => {
    const source = fakeSource({ spaExtraction: { enabled: false, max_posts_per_run: 10, post_age_days: 14 } });
    const r = await extractSpaIndex(source);
    expect(r).toBeNull();
    expect(scrapeUrlWithLinks).not.toHaveBeenCalled();
  });

  it("filters candidate links by the derived pattern, scrapes new ones, returns FeedEntries", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "News | Example",
      url: "https://example.com/news",
      published: "",
      markdown: "",
      description: "",
      links: [
        "https://example.com/news",                  // index self-link, dropped
        "https://example.com/news/post-alpha",       // matches default pattern
        "https://example.com/news/post-bravo",       // matches
        "https://example.com/about",                 // doesn't match
        "https://example.com/news/post-alpha",       // duplicate, dedup'd
      ],
    });

    vi.mocked(scrapeUrl).mockImplementation(async (url: string) => ({
      title: `Title for ${url.split("/").pop()}`,
      url,
      published: "2026-05-09T00:00:00Z",
      markdown: `# Title for ${url.split("/").pop()}\n\nBody text here.`,
      description: "Stub description",
    }));

    const source = fakeSource();
    // Use the test workspace
    const r = await extractSpaIndex(source);
    expect(r).not.toBeNull();
    expect(r!.extractionMethod).toBe("firecrawl_spa_posts");
    expect(r!.entries).toHaveLength(2);
    expect(r!.entries[0].link).toBe("https://example.com/news/post-alpha");
    expect(r!.entries[0].title).toBe("Title for post-alpha");
    expect(r!.entries[1].link).toBe("https://example.com/news/post-bravo");
    expect(scrapeUrl).toHaveBeenCalledTimes(2);
  });

  it("respects post_link_pattern override and exclude_pattern", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "News",
      url: "https://example.com/news",
      published: "",
      markdown: "",
      description: "",
      links: [
        "https://example.com/news/2026/05/featured",  // matches custom pattern
        "https://example.com/news/2026/05/draft",     // excluded
        "https://example.com/news/post-without-date", // doesn't match custom pattern
      ],
    });
    vi.mocked(scrapeUrl).mockResolvedValue({
      title: "Featured",
      url: "https://example.com/news/2026/05/featured",
      published: "",
      markdown: "",
      description: "",
    });

    const source = fakeSource({
      spaExtraction: {
        enabled: true,
        max_posts_per_run: 10,
        post_age_days: 14,
        post_link_pattern: "^https://example\\.com/news/\\d{4}/\\d{2}/[\\w-]+$",
        exclude_pattern: "/draft$",
      },
    });

    const r = await extractSpaIndex(source);
    expect(r!.entries).toHaveLength(1);
    expect(r!.entries[0].link).toBe("https://example.com/news/2026/05/featured");
    expect(scrapeUrl).toHaveBeenCalledTimes(1);
  });

  it("respects max_posts_per_run cap", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "News",
      url: "https://example.com/news",
      published: "",
      markdown: "",
      description: "",
      links: Array.from({ length: 20 }, (_, i) => `https://example.com/news/post-${i}`),
    });
    vi.mocked(scrapeUrl).mockResolvedValue({
      title: "x",
      url: "https://example.com/news/post-x",
      published: "",
      markdown: "",
      description: "",
    });

    const source = fakeSource({
      spaExtraction: { enabled: true, max_posts_per_run: 5, post_age_days: 14 },
    });
    const r = await extractSpaIndex(source);
    expect(r!.entries).toHaveLength(5);
    expect(scrapeUrl).toHaveBeenCalledTimes(5);
  });
});

describe("boilerplate-suffix stripping", () => {
  it("strips a shared trailing tagline across multiple titles", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "Blog | Site",
      url: "https://example.com/blog",
      published: "",
      markdown: "",
      description: "",
      links: [
        "https://example.com/blog/post-one",
        "https://example.com/blog/post-two",
        "https://example.com/blog/post-three",
      ],
    });

    const taglineSuffix = "Groq is fast, low cost inference.";
    const titles = [
      `Introducing MCP Connectors | ${taglineSuffix}`,
      `LPU Deconstructed | ${taglineSuffix}`,
      `GroqCloud Expanding | ${taglineSuffix}`,
    ];
    let i = 0;
    vi.mocked(scrapeUrl).mockImplementation(async () => ({
      title: titles[i++],
      url: "",
      published: "",
      markdown: "",
      description: "",
    }));

    const source: RssSource = {
      id: "src-rss-strip-cross",
      label: "Test Source",
      url: "https://example.com/blog",
      feedUrl: null,
      strategic_role: "industry_signal",
      spaExtraction: {
        enabled: true,
        max_posts_per_run: 10,
        post_age_days: 14,
      },
    };
    const r = await extractSpaIndex(source);
    expect(r).not.toBeNull();
    expect(r!.entries.map((e) => e.title)).toEqual([
      "Introducing MCP Connectors",
      "LPU Deconstructed",
      "GroqCloud Expanding",
    ]);
  });

  it("does not strip when titles diverge after the separator", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "",
      url: "https://example.com/blog",
      published: "",
      markdown: "",
      description: "",
      links: [
        "https://example.com/blog/post-one",
        "https://example.com/blog/post-two",
      ],
    });
    const titles = [
      "Foo Post | Different Subtitle One",
      "Bar Post | Different Subtitle Two",
    ];
    let i = 0;
    vi.mocked(scrapeUrl).mockImplementation(async () => ({
      title: titles[i++],
      url: "",
      published: "",
      markdown: "",
      description: "",
    }));

    const source: RssSource = {
      id: "src-rss-strip-diverge",
      label: "Test Source",
      url: "https://example.com/blog",
      feedUrl: null,
      strategic_role: "industry_signal",
      spaExtraction: {
        enabled: true,
        max_posts_per_run: 10,
        post_age_days: 14,
      },
    };
    const r = await extractSpaIndex(source);
    // Different suffixes → no stripping
    expect(r!.entries.map((e) => e.title)).toEqual(titles);
  });

  it("strips a single-title trailing source-label suffix", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "",
      url: "https://example.com/blog",
      published: "",
      markdown: "",
      description: "",
      links: ["https://example.com/blog/only-one-post"],
    });
    vi.mocked(scrapeUrl).mockResolvedValueOnce({
      title: "An Important Announcement | Acme AI Blog",
      url: "https://example.com/blog/only-one-post",
      published: "",
      markdown: "",
      description: "",
    });

    const source: RssSource = {
      id: "src-rss-strip-single",
      label: "Acme AI Blog",
      url: "https://example.com/blog",
      feedUrl: null,
      strategic_role: "industry_signal",
      spaExtraction: {
        enabled: true,
        max_posts_per_run: 10,
        post_age_days: 14,
      },
    };
    const r = await extractSpaIndex(source);
    expect(r!.entries[0].title).toBe("An Important Announcement");
  });
});

describe("sitemap-fallback discovery", () => {
  // Tests stub global.fetch (used by fetchSitemap) while leaving the Firecrawl
  // mocks (scrapeUrl/scrapeUrlWithLinks) untouched.
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
  });

  function mockFetchOnce(body: string, ok = true): void {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok,
      text: async () => body,
      status: ok ? 200 : 404,
    });
  }

  function mockFetchFailOnce(): void {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      text: async () => "",
      status: 404,
    });
  }

  it("rescues a SPA when Firecrawl returns 0 candidates but sitemap.xml has post URLs", async () => {
    // Firecrawl returns empty link list (e.g. JS-rendered SPA)
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "Blog",
      url: "https://example.com/blog",
      published: "",
      markdown: "",
      description: "",
      links: [],
    });
    // Root /sitemap.xml returns post URLs
    mockFetchOnce(`<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/blog/post-one</loc></url>
  <url><loc>https://example.com/blog/post-two</loc></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`);
    // Mock per-post scrape
    vi.mocked(scrapeUrl).mockImplementation(async (url: string) => ({
      title: `Title for ${url.split("/").pop()}`,
      url,
      published: "",
      markdown: "",
      description: "",
    }));

    const source: RssSource = {
      id: "src-rss-sitemap-rescue",
      label: "Test Sitemap",
      url: "https://example.com/blog",
      feedUrl: null,
      strategic_role: "industry_signal",
      spaExtraction: { enabled: true, max_posts_per_run: 10, post_age_days: 14 },
    };
    const r = await extractSpaIndex(source);
    expect(r).not.toBeNull();
    expect(r!.entries).toHaveLength(2);
    expect(r!.entries[0].link).toBe("https://example.com/blog/post-one");
    expect(r!.entries[1].link).toBe("https://example.com/blog/post-two");
    // /about must be filtered out by the auto-derived pattern
  });

  it("merges Firecrawl + sitemap candidates without duplicating", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "Blog",
      url: "https://example.com/blog",
      published: "",
      markdown: "",
      description: "",
      links: [
        "https://example.com/blog/post-one",
        "https://example.com/blog/post-two",
      ],
    });
    mockFetchOnce(`<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/blog/post-two</loc></url>
  <url><loc>https://example.com/blog/post-three</loc></url>
</urlset>`);
    vi.mocked(scrapeUrl).mockImplementation(async (url: string) => ({
      title: `Post ${url.split("/").pop()}`,
      url,
      published: "",
      markdown: "",
      description: "",
    }));

    const source: RssSource = {
      id: "src-rss-sitemap-merge",
      label: "Test Merge",
      url: "https://example.com/blog",
      feedUrl: null,
      strategic_role: "industry_signal",
      spaExtraction: { enabled: true, max_posts_per_run: 10, post_age_days: 14 },
    };
    const r = await extractSpaIndex(source);
    // Expect 3 unique posts (post-one, post-two from Firecrawl + post-three from sitemap)
    // post-two is in both but should be deduped
    expect(r!.entries).toHaveLength(3);
    const links = r!.entries.map((e) => e.link).sort();
    expect(links).toEqual([
      "https://example.com/blog/post-one",
      "https://example.com/blog/post-three",
      "https://example.com/blog/post-two",
    ]);
  });

  it("recurses into a sitemap-index file", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "Blog",
      url: "https://example.com/blog",
      published: "",
      markdown: "",
      description: "",
      links: [],
    });
    // /sitemap.xml is a sitemap-index
    mockFetchOnce(`<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`);
    // First child sitemap → real post URLs
    mockFetchOnce(`<?xml version="1.0"?>
<urlset><url><loc>https://example.com/blog/recursed-post</loc></url></urlset>`);
    // Second child sitemap → non-post URLs (filtered out by pattern)
    mockFetchOnce(`<?xml version="1.0"?>
<urlset><url><loc>https://example.com/about</loc></url></urlset>`);

    vi.mocked(scrapeUrl).mockResolvedValueOnce({
      title: "Recursed Post",
      url: "https://example.com/blog/recursed-post",
      published: "",
      markdown: "",
      description: "",
    });

    const source: RssSource = {
      id: "src-rss-sitemap-index",
      label: "Test Index",
      url: "https://example.com/blog",
      feedUrl: null,
      strategic_role: "industry_signal",
      spaExtraction: { enabled: true, max_posts_per_run: 10, post_age_days: 14 },
    };
    const r = await extractSpaIndex(source);
    expect(r!.entries).toHaveLength(1);
    expect(r!.entries[0].link).toBe("https://example.com/blog/recursed-post");
  });

  it("handles missing sitemap gracefully (404 on root, 404 on index-suffixed)", async () => {
    vi.mocked(scrapeUrlWithLinks).mockResolvedValueOnce({
      title: "Blog",
      url: "https://example.com/blog",
      published: "",
      markdown: "",
      description: "",
      links: ["https://example.com/blog/firecrawl-only"],
    });
    // Both sitemap fetches fail
    mockFetchFailOnce();
    mockFetchFailOnce();

    vi.mocked(scrapeUrl).mockResolvedValueOnce({
      title: "Firecrawl Only",
      url: "https://example.com/blog/firecrawl-only",
      published: "",
      markdown: "",
      description: "",
    });

    const source: RssSource = {
      id: "src-rss-no-sitemap",
      label: "No Sitemap",
      url: "https://example.com/blog",
      feedUrl: null,
      strategic_role: "industry_signal",
      spaExtraction: { enabled: true, max_posts_per_run: 10, post_age_days: 14 },
    };
    const r = await extractSpaIndex(source);
    // Falls through to Firecrawl-only candidates; doesn't crash
    expect(r!.entries).toHaveLength(1);
    expect(r!.entries[0].link).toBe("https://example.com/blog/firecrawl-only");
  });

  // Restore real fetch when this describe block finishes
  afterAll(() => {
    globalThis.fetch = realFetch;
  });
});
