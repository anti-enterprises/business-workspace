#!/usr/bin/env tsx
/**
 * Scrape competitive reviews from G2, Capterra, and TrustRadius.
 *
 * Usage:
 *   npx tsx scripts/scrape-reviews.ts --products hubspot-crm,notion    # scrape specific products
 *   npx tsx scripts/scrape-reviews.ts --platform g2                     # scrape G2 only
 *   npx tsx scripts/scrape-reviews.ts --category automation,agent_builder  # scrape by category
 *   npx tsx scripts/scrape-reviews.ts --max-reviews 10                  # limit reviews per product
 *   npx tsx scripts/scrape-reviews.ts --dry-run                         # print without storing
 *   npx tsx scripts/scrape-reviews.ts --list-actors                     # show available actors
 *   npx tsx scripts/scrape-reviews.ts --list-products                   # show product registry
 */

import dotenv from "dotenv";
import { runActor } from "../execution/apis/apify.js";
import {
  type UpsertReviewInput,
  normalizeG2Review,
  normalizeAllInOneReview,
  normalizeCapterraReview,
} from "../execution/types/review.js";
import { upsertReviews } from "../execution/db/reviews.js";
import { closePool } from "../execution/db/client.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

// ---------------------------------------------------------------------------
// Apify actor registry
// ---------------------------------------------------------------------------

const ACTORS = {
  g2Reviews: {
    id: "zen-studio~g2-reviews-scraper",
    purpose: "G2 product reviews (star ratings, pros/cons, reviewer metadata)",
  },
  g2Overview: {
    id: "automation-lab~g2-scraper",
    purpose: "G2 product overview page (category, description, pricing)",
  },
  allInOne: {
    id: "zen-studio~software-review-scraper",
    purpose: "All-in-one review scraper (TrustRadius and other platforms)",
  },
  capterra: {
    id: "dionysus_way~capterra-reviews",
    purpose: "Capterra reviews (single product URL)",
  },
  capterraBulk: {
    id: "getdataforme~capterra-reviews-scraper-bulk",
    purpose: "Capterra reviews bulk (multiple product URLs)",
  },
} as const;

// ---------------------------------------------------------------------------
// Product registry
// ---------------------------------------------------------------------------

interface ProductTarget {
  name: string;
  category: string;
  g2Slug?: string;
  capterraId?: string;
  trustRadiusUrl?: string;
  hypotheses?: string[];
}

const PRODUCT_REGISTRY: ProductTarget[] = [
  // --- Cat 1: AI Automation Platforms (H002 — agent proliferation) ---
  { name: "Zapier", category: "automation", g2Slug: "zapier", capterraId: "158548/Zapier", hypotheses: ["H002"] },
  { name: "Make", category: "automation", g2Slug: "make", capterraId: "168498/Make", hypotheses: ["H002"] },
  { name: "n8n", category: "automation", g2Slug: "n8n-io", capterraId: "233028/n8n-io", hypotheses: ["H002"] },
  { name: "ActivePieces", category: "automation", g2Slug: "activepieces", hypotheses: ["H002"] },
  { name: "Bardeen", category: "automation", g2Slug: "bardeen", hypotheses: ["H002"] },
  { name: "Relay.app", category: "automation", g2Slug: "relay-app", hypotheses: ["H002"] },

  // --- Cat 2: AI Agent/Chatbot Builders (H002 + H006 — DIY failure signals) ---
  { name: "Botpress", category: "agent_builder", g2Slug: "botpress", hypotheses: ["H002", "H006"] },
  { name: "Voiceflow", category: "agent_builder", g2Slug: "voiceflow", hypotheses: ["H002", "H006"] },
  { name: "Stack AI", category: "agent_builder", g2Slug: "stack-ai", hypotheses: ["H002", "H006"] },
  { name: "Relevance AI", category: "agent_builder", g2Slug: "relevance-ai", hypotheses: ["H002", "H006"] },
  { name: "Bland AI", category: "agent_builder", g2Slug: "bland-ai", hypotheses: ["H006"] },
  { name: "Synthflow", category: "agent_builder", g2Slug: "synthflow-ai", hypotheses: ["H006"] },
  { name: "Vapi", category: "agent_builder", g2Slug: "vapi", hypotheses: ["H006"] },
  { name: "Chatbase", category: "agent_builder", g2Slug: "chatbase", hypotheses: ["H006"] },
  { name: "CustomGPT", category: "agent_builder", g2Slug: "customgpt-ai", hypotheses: ["H006"] },
  { name: "Intercom", category: "agent_builder", g2Slug: "intercom", capterraId: "118914/Intercom", hypotheses: ["H002", "H006"] },

  // --- Cat 3: AI Business Tools — ICP's Existing Stack (H006) ---
  { name: "Notion", category: "icp_stack", g2Slug: "notion", capterraId: "195702/Notion", hypotheses: ["H006"] },
  { name: "ClickUp", category: "icp_stack", g2Slug: "clickup", capterraId: "186498/ClickUp", hypotheses: ["H006"] },
  { name: "Monday.com", category: "icp_stack", g2Slug: "monday-com", capterraId: "147364/monday-com", hypotheses: ["H006"] },
  { name: "HubSpot CRM", category: "icp_stack", g2Slug: "hubspot-crm", capterraId: "140174/HubSpot-CRM", hypotheses: ["H006"] },
  { name: "Salesforce", category: "icp_stack", g2Slug: "salesforce-sales-cloud", capterraId: "113580/Salesforce-Sales-Cloud", hypotheses: ["H006"] },
  { name: "Pipedrive", category: "icp_stack", g2Slug: "pipedrive", capterraId: "132522/Pipedrive", hypotheses: ["H006"] },
  { name: "GoHighLevel", category: "icp_stack", g2Slug: "gohighlevel", capterraId: "227833/GoHighLevel", hypotheses: ["H002", "H006"] },
  { name: "Zoho CRM", category: "icp_stack", g2Slug: "zoho-crm", capterraId: "124041/Zoho-CRM", hypotheses: ["H006"] },
  { name: "Freshdesk", category: "icp_stack", g2Slug: "freshdesk", capterraId: "134082/Freshdesk", hypotheses: ["H006"] },
  { name: "Zendesk", category: "icp_stack", g2Slug: "zendesk", capterraId: "118928/Zendesk", hypotheses: ["H006"] },

  // --- Cat 4: AI Content/Marketing Tools (H004) ---
  { name: "Jasper", category: "content_tools", g2Slug: "jasper", capterraId: "224591/Jasper", hypotheses: ["H004"] },
  { name: "Copy.ai", category: "content_tools", g2Slug: "copy-ai", capterraId: "232291/Copy-ai", hypotheses: ["H004"] },
  { name: "Writer", category: "content_tools", g2Slug: "writer-com", hypotheses: ["H004"] },
  { name: "Descript", category: "content_tools", g2Slug: "descript", capterraId: "187898/Descript", hypotheses: ["H004"] },
  { name: "Synthesia", category: "content_tools", g2Slug: "synthesia", capterraId: "232398/Synthesia", hypotheses: ["H004"] },
  { name: "HeyGen", category: "content_tools", g2Slug: "heygen", hypotheses: ["H004"] },
  { name: "ElevenLabs", category: "content_tools", g2Slug: "elevenlabs", hypotheses: ["H004"] },
  { name: "Pictory", category: "content_tools", g2Slug: "pictory", hypotheses: ["H004"] },

  // --- Cat 5: MSP/IT Management Tools (incumbent market positioning) ---
  { name: "ConnectWise", category: "msp_tools", g2Slug: "connectwise-automate", capterraId: "58608/ConnectWise-Automate", hypotheses: ["H001", "H002"] },
  { name: "NinjaOne", category: "msp_tools", g2Slug: "ninjaone", capterraId: "214338/NinjaOne", hypotheses: ["H001", "H002"] },
  { name: "Atera", category: "msp_tools", g2Slug: "atera", capterraId: "162418/Atera", hypotheses: ["H001", "H002"] },
  { name: "Datto", category: "msp_tools", g2Slug: "datto", capterraId: "153498/Datto", hypotheses: ["H002"] },
  { name: "HaloPSA", category: "msp_tools", g2Slug: "halopsa", hypotheses: ["H002"] },
  { name: "SyncroMSP", category: "msp_tools", g2Slug: "syncro", capterraId: "188358/Syncro", hypotheses: ["H001", "H002"] },

  // --- Cat 6: RPA/Enterprise Automation (H002 — compression signals) ---
  { name: "UiPath", category: "rpa", g2Slug: "uipath", capterraId: "207898/UiPath", hypotheses: ["H002"] },
  { name: "Power Automate", category: "rpa", g2Slug: "microsoft-power-automate", capterraId: "211418/Microsoft-Power-Automate", hypotheses: ["H002"] },
  { name: "Automation Anywhere", category: "rpa", g2Slug: "automation-anywhere", hypotheses: ["H002"] },

  // --- Cat 7: AI Dev Tools (technical moat intelligence) ---
  { name: "Cursor", category: "dev_tools", g2Slug: "cursor", hypotheses: ["H002"] },
  { name: "Replit", category: "dev_tools", g2Slug: "replit", capterraId: "188198/Replit", hypotheses: ["H002"] },
  { name: "GitHub Copilot", category: "dev_tools", g2Slug: "github-copilot", hypotheses: ["H002"] },
  { name: "Vercel", category: "dev_tools", g2Slug: "vercel", hypotheses: ["H002"] },
  { name: "LangChain", category: "dev_tools", g2Slug: "langchain", hypotheses: ["H002"] },
  { name: "CrewAI", category: "dev_tools", g2Slug: "crewai", hypotheses: ["H002"] },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = "g2" | "capterra" | "trustradius";

interface ScrapeResult {
  product: string;
  platform: Platform;
  reviews: UpsertReviewInput[];
  error?: string;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  products: string[];
  categories: string[];
  platforms: Platform[];
  maxReviews: number;
  dryRun: boolean;
  listActors: boolean;
  listProducts: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    products: [],
    categories: [],
    platforms: ["g2", "capterra", "trustradius"],
    maxReviews: 50,
    dryRun: false,
    listActors: false,
    listProducts: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--products":
        result.products = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--category":
        result.categories = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--platform":
        result.platforms = (args[++i] ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase() as Platform)
          .filter((p): p is Platform => ["g2", "capterra", "trustradius"].includes(p));
        break;
      case "--max-reviews":
        result.maxReviews = parseInt(args[++i] ?? "50", 10);
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--list-actors":
        result.listActors = true;
        break;
      case "--list-products":
        result.listProducts = true;
        break;
      default:
        if (args[i].startsWith("--")) {
          console.error(`Unknown argument: ${args[i]}`);
          process.exit(1);
        }
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scraping helpers
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveProducts(filter: string[], categories: string[]): ProductTarget[] {
  let pool = PRODUCT_REGISTRY;

  if (categories.length > 0) {
    pool = pool.filter((p) => categories.includes(p.category));
  }

  if (filter.length > 0) {
    const slugs = new Set(filter.map((f) => toSlug(f)));
    pool = pool.filter(
      (p) => slugs.has(toSlug(p.name)) || (p.g2Slug && slugs.has(p.g2Slug)),
    );
  }

  if (pool.length === 0) {
    console.error(`No products matched filters.`);
    console.error(`Categories: ${[...new Set(PRODUCT_REGISTRY.map((p) => p.category))].join(", ")}`);
    console.error(`Products: ${PRODUCT_REGISTRY.map((p) => p.g2Slug ?? toSlug(p.name)).join(", ")}`);
    process.exit(1);
  }

  return pool;
}

function printProducts() {
  const categories = [...new Set(PRODUCT_REGISTRY.map((p) => p.category))];
  console.log(`\n${PRODUCT_REGISTRY.length} products in registry across ${categories.length} categories:\n`);
  for (const cat of categories) {
    const products = PRODUCT_REGISTRY.filter((p) => p.category === cat);
    console.log(`  ${cat} (${products.length}):`);
    for (const p of products) {
      const platforms = [p.g2Slug ? "G2" : null, p.capterraId ? "Capterra" : null, p.trustRadiusUrl ? "TR" : null].filter(Boolean).join(", ");
      console.log(`    - ${p.name} [${platforms || "no platform IDs"}]`);
    }
    console.log();
  }
}

async function scrapeG2Reviews(
  product: ProductTarget,
  maxReviews: number,
): Promise<ScrapeResult> {
  const platform: Platform = "g2";

  if (!product.g2Slug) {
    return { product: product.name, platform, reviews: [], error: "No G2 slug configured" };
  }

  try {
    console.log(`  [G2] Scraping ${product.name} (${product.g2Slug})...`);
    const rawResults = await runActor<Record<string, unknown>>(ACTORS.g2Reviews.id, {
      url: `https://www.g2.com/products/${product.g2Slug}/reviews`,
      maxReviews,
    });

    const reviews = (rawResults ?? []).map((raw) => normalizeG2Review(raw));
    console.log(`  [G2] Got ${reviews.length} reviews for ${product.name}`);
    return { product: product.name, platform, reviews };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [G2] Error scraping ${product.name}: ${msg}`);
    return { product: product.name, platform, reviews: [], error: msg };
  }
}

async function scrapeCapterraReviews(
  product: ProductTarget,
  maxReviews: number,
): Promise<ScrapeResult> {
  const platform: Platform = "capterra";

  if (!product.capterraId) {
    return {
      product: product.name,
      platform,
      reviews: [],
      error: "No Capterra ID configured",
    };
  }

  try {
    console.log(`  [Capterra] Scraping ${product.name} (${product.capterraId})...`);
    const url = `https://www.capterra.com/p/${product.capterraId}/reviews/`;
    const rawResults = await runActor<Record<string, unknown>>(ACTORS.capterra.id, {
      startUrls: [url],
      maxReviews,
    });

    const reviews = (rawResults ?? []).map((raw) => normalizeCapterraReview(raw));
    console.log(`  [Capterra] Got ${reviews.length} reviews for ${product.name}`);
    return { product: product.name, platform, reviews };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [Capterra] Error scraping ${product.name}: ${msg}`);
    return { product: product.name, platform, reviews: [], error: msg };
  }
}

async function scrapeTrustRadiusReviews(
  product: ProductTarget,
  maxReviews: number,
): Promise<ScrapeResult> {
  const platform: Platform = "trustradius";

  if (!product.trustRadiusUrl) {
    return {
      product: product.name,
      platform,
      reviews: [],
      error: "No TrustRadius URL configured",
    };
  }

  try {
    console.log(`  [TrustRadius] Scraping ${product.name}...`);
    const rawResults = await runActor<Record<string, unknown>>(ACTORS.allInOne.id, {
      startUrls: [{ url: product.trustRadiusUrl }],
      maxReviews,
    });

    const reviews = (rawResults ?? []).map((raw) => normalizeAllInOneReview(raw));
    console.log(`  [TrustRadius] Got ${reviews.length} reviews for ${product.name}`);
    return { product: product.name, platform, reviews };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [TrustRadius] Error scraping ${product.name}: ${msg}`);
    return { product: product.name, platform, reviews: [], error: msg };
  }
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function printActors() {
  console.log("\nAvailable Apify actors:\n");
  console.log("| # | Actor ID                                      | Purpose                                         |");
  console.log("|---|-----------------------------------------------|-------------------------------------------------|");
  Object.values(ACTORS).forEach((actor, i) => {
    console.log(
      `| ${i + 1} | ${actor.id.padEnd(45)} | ${actor.purpose.padEnd(47)} |`,
    );
  });
  console.log();
}

function printSummaryTable(results: ScrapeResult[]) {
  console.log("\n=== Scrape Summary ===\n");
  console.log("| Product          | Platform    | Reviews | Status |");
  console.log("|------------------|-------------|---------|--------|");

  let totalReviews = 0;
  let totalErrors = 0;

  for (const r of results) {
    const status = r.error ? `ERR: ${r.error.slice(0, 30)}` : "OK";
    const padProduct = r.product.padEnd(16);
    const padPlatform = r.platform.padEnd(11);
    const padCount = String(r.reviews.length).padStart(7);
    console.log(`| ${padProduct} | ${padPlatform} | ${padCount} | ${status} |`);
    totalReviews += r.reviews.length;
    if (r.error) totalErrors++;
  }

  console.log();
  console.log(`Total reviews scraped: ${totalReviews}`);
  if (totalErrors > 0) console.log(`Errors encountered:    ${totalErrors}`);
}

function printDryRunReviews(results: ScrapeResult[]) {
  for (const r of results) {
    if (r.reviews.length === 0) continue;

    console.log(`\n--- ${r.product} [${r.platform}] (${r.reviews.length} reviews) ---\n`);
    for (const review of r.reviews.slice(0, 5)) {
      console.log(`  ID:       ${review.review_id}`);
      console.log(`  Rating:   ${review.rating ?? "N/A"} / 5`);
      console.log(`  Title:    ${review.title ?? "(no title)"}`);
      console.log(`  Reviewer: ${review.reviewer_name ?? "Anonymous"}`);
      if (review.reviewer_job_title) {
        console.log(`  Role:     ${review.reviewer_job_title}`);
      }
      if (review.pros) {
        console.log(`  Pros:     ${review.pros.slice(0, 120)}...`);
      }
      if (review.cons) {
        console.log(`  Cons:     ${review.cons.slice(0, 120)}...`);
      }
      console.log();
    }

    if (r.reviews.length > 5) {
      console.log(`  ... and ${r.reviews.length - 5} more reviews\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  // --- --list-actors / --list-products ---
  if (args.listActors) {
    printActors();
    return;
  }
  if (args.listProducts) {
    printProducts();
    return;
  }

  // --- Preflight checks ---
  if (!process.env.APIFY_API_TOKEN) {
    console.error("Missing APIFY_API_TOKEN in .env.local");
    console.error("\nSetup:");
    console.error("  1. Go to https://console.apify.com/account/integrations");
    console.error("  2. Copy your API token");
    console.error("  3. Add to .env.local:");
    console.error("       APIFY_API_TOKEN=your-token-here");
    process.exit(1);
  }

  const products = resolveProducts(args.products, args.categories);
  console.log(
    `Scraping reviews for ${products.length} product(s) across ${args.platforms.join(", ")}`,
  );
  console.log(`Max reviews per product/platform: ${args.maxReviews}`);
  if (args.dryRun) console.log("(dry-run mode -- reviews will be printed, not stored)\n");
  else console.log();

  // --- Scrape each product/platform combination ---
  const allResults: ScrapeResult[] = [];

  for (const product of products) {
    console.log(`\n>>> ${product.name}`);

    if (args.platforms.includes("g2")) {
      allResults.push(await scrapeG2Reviews(product, args.maxReviews));
    }

    if (args.platforms.includes("capterra")) {
      allResults.push(await scrapeCapterraReviews(product, args.maxReviews));
    }

    if (args.platforms.includes("trustradius")) {
      allResults.push(await scrapeTrustRadiusReviews(product, args.maxReviews));
    }
  }

  // --- Collect all reviews ---
  const allReviews = allResults.flatMap((r) => r.reviews);

  // --- Store or print ---
  if (args.dryRun) {
    printDryRunReviews(allResults);
  } else if (allReviews.length > 0) {
    console.log(`\nStoring ${allReviews.length} reviews in database...`);
    try {
      const { inserted, updated } = await upsertReviews(allReviews);
      console.log(`Done. Inserted: ${inserted}, Updated: ${updated}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Database error: ${msg}`);
    }
  } else {
    console.log("\nNo reviews scraped.");
  }

  // --- Summary ---
  printSummaryTable(allResults);

  await closePool();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  closePool().catch(() => {});
  process.exit(1);
});
