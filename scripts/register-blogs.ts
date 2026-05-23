#!/usr/bin/env tsx
/**
 * One-shot script: register ~150 company blog sources for RSS monitoring.
 *
 * Embeds the full blog watchlist as structured data, discovers RSS feed URLs
 * via the discoverFeedUrl helper, and writes YAML source files per category.
 *
 * Usage:
 *   npx tsx scripts/register-blogs.ts             # discover feeds + write YAML files
 *   npx tsx scripts/register-blogs.ts --dry-run    # preview without writing
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { stringify } from "yaml";
import dotenv from "dotenv";
import { discoverFeedUrl } from "../execution/apis/rss.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlogEntry {
  label: string;
  url: string;
  tier: 0 | 1;
}

interface Category {
  name: string;
  tag: string;
  filename: string;
  blogs: BlogEntry[];
}

// ---------------------------------------------------------------------------
// Blog data — every entry from the watchlist
// ---------------------------------------------------------------------------

const CATEGORIES: Category[] = [
  // ---- Category 1: Frontier Labs ----
  {
    name: "Frontier Labs",
    tag: "frontier_labs",
    filename: "blogs-frontier-labs.yaml",
    blogs: [
      { label: "OpenAI News", url: "https://openai.com/news/", tier: 0 },
      { label: "OpenAI Developer Blog", url: "https://developers.openai.com/blog", tier: 0 },
      { label: "Anthropic News", url: "https://www.anthropic.com/news", tier: 0 },
      { label: "Anthropic Research", url: "https://www.anthropic.com/research", tier: 0 },
      { label: "Google DeepMind Blog", url: "https://deepmind.google/blog/", tier: 0 },
      { label: "Google Research Blog", url: "https://research.google/blog/", tier: 0 },
      { label: "Meta AI Blog", url: "https://ai.meta.com/blog/", tier: 0 },
      { label: "Llama official", url: "https://www.llama.com/", tier: 0 },
      { label: "Mistral AI News", url: "https://mistral.ai/news", tier: 0 },
      { label: "xAI News", url: "https://x.ai/news", tier: 0 },
      { label: "Cohere Blog", url: "https://cohere.com/blog", tier: 1 },
      { label: "AI21 Blog", url: "https://www.ai21.com/blog/", tier: 1 },
      { label: "DeepSeek News", url: "https://api-docs.deepseek.com/news", tier: 0 },
      { label: "Qwen Blog", url: "https://qwen.ai/blog", tier: 0 },
      { label: "Baidu ERNIE Blog", url: "https://ernie.baidu.com/blog/", tier: 1 },
      { label: "Z.ai / GLM Blog", url: "https://z.ai/blog", tier: 0 },
      { label: "Kimi / Moonshot Blog", url: "https://www.kimi.com/blog/", tier: 0 },
      { label: "MiniMax News", url: "https://www.minimax.io/news", tier: 0 },
      { label: "Tencent Hunyuan", url: "https://hunyuan.tencent.com/", tier: 1 },
      { label: "ByteDance Seed", url: "https://seed.bytedance.com/en/", tier: 1 },
      { label: "Stability AI News", url: "https://stability.ai/news-updates", tier: 1 },
      { label: "Nous Research Blog", url: "https://nousresearch.com/blog/", tier: 1 },
      { label: "TII Falcon Blog", url: "https://falcon-lm.github.io/blog/", tier: 1 },
      { label: "Allen AI Blog", url: "https://allenai.org/blog", tier: 1 },
      { label: "IBM Granite", url: "https://www.ibm.com/granite", tier: 1 },
      { label: "Liquid AI Blog", url: "https://www.liquid.ai/company/blog", tier: 1 },
      { label: "Reka News", url: "https://reka.ai/news", tier: 1 },
      { label: "Nomic Blog", url: "https://www.nomic.ai/blog", tier: 1 },
      { label: "Databricks AI", url: "https://www.databricks.com/blog/category/artificial-intelligence", tier: 1 },
      { label: "Snowflake AI", url: "https://www.snowflake.com/en/blog/category/artificial-intelligence/", tier: 1 },
    ],
  },

  // ---- Category 2: Developer Tools ----
  {
    name: "Developer Tools",
    tag: "developer_tools",
    filename: "blogs-developer-tools.yaml",
    blogs: [
      { label: "Hugging Face Blog", url: "https://huggingface.co/blog", tier: 1 },
      { label: "Perplexity Hub", url: "https://www.perplexity.ai/hub", tier: 1 },
      { label: "Runway Research", url: "https://runwayml.com/research", tier: 1 },
      { label: "ElevenLabs Blog", url: "https://elevenlabs.io/blog", tier: 1 },
      { label: "Synthesia Blog", url: "https://www.synthesia.io/blog", tier: 1 },
      { label: "HeyGen Blog", url: "https://www.heygen.com/blog", tier: 1 },
      { label: "Suno Blog", url: "https://suno.com/blog", tier: 1 },
      { label: "Udio Blog", url: "https://www.udio.com/blog", tier: 1 },
      { label: "Together AI Blog", url: "https://www.together.ai/blog", tier: 1 },
      { label: "Fireworks AI Blog", url: "https://fireworks.ai/blog", tier: 1 },
      { label: "Groq Blog", url: "https://groq.com/blog", tier: 1 },
      { label: "Cerebras Blog", url: "https://www.cerebras.ai/blog", tier: 1 },
      { label: "LangChain Blog", url: "https://www.langchain.com/blog", tier: 1 },
      { label: "LlamaIndex Blog", url: "https://www.llamaindex.ai/blog", tier: 1 },
      { label: "Cursor Blog", url: "https://cursor.com/blog", tier: 1 },
      { label: "Cognition Blog", url: "https://cognition.ai/blog", tier: 1 },
      { label: "Replit Blog", url: "https://blog.replit.com/", tier: 1 },
      { label: "GitHub AI Blog", url: "https://github.blog/ai-and-ml/", tier: 1 },
      { label: "Sourcegraph Blog", url: "https://sourcegraph.com/blog", tier: 1 },
      { label: "Vercel Blog", url: "https://vercel.com/blog", tier: 1 },
      { label: "Baseten Blog", url: "https://www.baseten.co/blog", tier: 1 },
      { label: "Modal Blog", url: "https://modal.com/blog", tier: 1 },
      { label: "Replicate Blog", url: "https://replicate.com/blog", tier: 1 },
      { label: "Anyscale Blog", url: "https://www.anyscale.com/blog", tier: 1 },
      { label: "Scale AI Blog", url: "https://scale.com/blog", tier: 1 },
      { label: "Labelbox Blog", url: "https://labelbox.com/blog", tier: 1 },
      { label: "Weights & Biases Blog", url: "https://wandb.ai/site/blog/", tier: 1 },
      { label: "Arize AI Blog", url: "https://arize.com/blog/", tier: 1 },
      { label: "Braintrust Blog", url: "https://www.braintrust.dev/blog", tier: 1 },
      { label: "E2B Blog", url: "https://e2b.dev/blog", tier: 1 },
    ],
  },

  // ---- Category 3: Cloud & Infrastructure ----
  {
    name: "Cloud & Infrastructure",
    tag: "cloud_infra",
    filename: "blogs-cloud-infra.yaml",
    blogs: [
      { label: "AWS ML Blog", url: "https://aws.amazon.com/blogs/machine-learning/", tier: 0 },
      { label: "Google Cloud AI Blog", url: "https://cloud.google.com/blog/products/ai-machine-learning", tier: 0 },
      { label: "Azure AI Foundry Blog", url: "https://techcommunity.microsoft.com/category/azure-ai-foundry/blog/azure-ai-foundry-blog/", tier: 0 },
      { label: "Oracle AI Blog", url: "https://blogs.oracle.com/ai-and-datascience/", tier: 1 },
      { label: "IBM AI Newsroom", url: "https://newsroom.ibm.com/latest-news-artificial-intelligence", tier: 1 },
      { label: "Cloudflare AI", url: "https://blog.cloudflare.com/tag/ai/", tier: 1 },
      { label: "CoreWeave Blog", url: "https://www.coreweave.com/blog-categories/blog", tier: 0 },
      { label: "Crusoe Blog", url: "https://www.crusoe.ai/blog", tier: 1 },
      { label: "Lambda Blog", url: "https://lambda.ai/blog", tier: 1 },
      { label: "Vultr Blog", url: "https://blogs.vultr.com/", tier: 0 },
      { label: "Nebius Blog", url: "https://nebius.com/blog", tier: 0 },
      { label: "RunPod Blog", url: "https://runpod.ghost.io/", tier: 1 },
      { label: "GMI Cloud Blog", url: "https://www.gmicloud.ai/blog", tier: 1 },
      { label: "Fluidstack Blog", url: "https://www.fluidstack.io/about-us/blog", tier: 1 },
      { label: "Nscale Blog", url: "https://www.nscale.com/blog", tier: 1 },
      { label: "DigitalOcean AI Blog", url: "https://www.digitalocean.com/blog/tags/ai-ml", tier: 1 },
      { label: "MongoDB AI Blog", url: "https://www.mongodb.com/blog/category/artificial-intelligence", tier: 1 },
      { label: "Elastic Search Labs", url: "https://www.elastic.co/search-labs", tier: 1 },
      { label: "Pinecone Blog", url: "https://www.pinecone.io/blog/", tier: 1 },
      { label: "Weaviate Blog", url: "https://weaviate.io/blog", tier: 1 },
      { label: "Chroma Blog", url: "https://www.trychroma.com/blog", tier: 1 },
      { label: "Qdrant Blog", url: "https://qdrant.tech/blog/", tier: 1 },
      { label: "Zilliz Blog", url: "https://zilliz.com/blog", tier: 1 },
      { label: "Redis AI Blog", url: "https://redis.io/blog/tag/ai/", tier: 1 },
      { label: "Supabase AI Blog", url: "https://supabase.com/blog/tags/ai", tier: 1 },
      { label: "Confluent AI Blog", url: "https://www.confluent.io/blog/tag/artificial-intelligence/", tier: 1 },
    ],
  },

  // ---- Category 4: Semiconductors ----
  {
    name: "Semiconductors",
    tag: "semiconductor",
    filename: "blogs-semiconductor.yaml",
    blogs: [
      { label: "NVIDIA AI Blog", url: "https://blogs.nvidia.com/blog/category/deep-learning/", tier: 0 },
      { label: "NVIDIA Developer AI", url: "https://developer.nvidia.com/blog/category/artificial-intelligence/", tier: 0 },
      { label: "AMD Newsroom", url: "https://www.amd.com/en/newsroom.html", tier: 0 },
      { label: "Intel AI Blog", url: "https://community.intel.com/t5/Blogs/Tech-Innovation/Artificial-Intelligence-AI/bg-p/blog-ai", tier: 1 },
      { label: "Arm AI Blog", url: "https://developer.arm.com/community/arm-community-blogs/b/ai-blog", tier: 1 },
      { label: "Qualcomm AI Research", url: "https://www.qualcomm.com/research/artificial-intelligence", tier: 1 },
      { label: "Broadcom Blog", url: "https://www.broadcom.com/blog", tier: 1 },
      { label: "Marvell AI Blog", url: "https://www.marvell.com/blogs.html?category=blogs%3Acategories%2Fai", tier: 1 },
      { label: "TSMC HPC", url: "https://www.tsmc.com/english/dedicatedFoundry/technology/platform_HPC", tier: 0 },
      { label: "Samsung Semiconductor", url: "https://semiconductor.samsung.com/news-events/", tier: 1 },
      { label: "SK hynix Newsroom", url: "https://news.skhynix.com/", tier: 0 },
      { label: "Micron Blog", url: "https://www.micron.com/about/blog", tier: 0 },
      { label: "ASML Stories", url: "https://www.asml.com/en/news/stories", tier: 1 },
      { label: "Applied Materials Blog", url: "https://www.appliedmaterials.com/us/en/blog.html", tier: 1 },
      { label: "Lam Research Blog", url: "https://blog.lamresearch.com/", tier: 1 },
      { label: "KLA News", url: "https://www.kla.com/advance/", tier: 1 },
      { label: "Cadence Blog", url: "https://community.cadence.com/cadence_blogs_8/", tier: 1 },
      { label: "Synopsys Blog", url: "https://www.synopsys.com/blogs.html", tier: 1 },
      { label: "Supermicro Resources", url: "https://www.supermicro.com/en/resource-center", tier: 1 },
      { label: "Dell AI Blog", url: "https://www.dell.com/en-us/blog/tags/artificial-intelligence/", tier: 1 },
      { label: "HPE AI Blog", url: "https://www.hpe.com/us/en/newsroom/blog-posts/artificial-intelligence.html", tier: 1 },
      { label: "Lenovo AI Infrastructure", url: "https://www.lenovo.com/us/en/servers-storage/solutions/ai/", tier: 1 },
      { label: "Vertiv Blog", url: "https://www.vertiv.com/en-us/about/news-and-insights/vertiv-blog/", tier: 1 },
      { label: "Schneider Electric DC Blog", url: "https://blog.se.com/datacenter/", tier: 1 },
      { label: "Eaton DC Blog", url: "https://www.eaton.com/us/en-us/company/news-insights/blog.html", tier: 1 },
      { label: "Siemens DC AI", url: "https://www.siemens.com/en-us/industries/data-centers/ai-workload-infrastructure-management/", tier: 1 },
      { label: "ABB Data Centers", url: "https://new.abb.com/data-centers", tier: 1 },
      { label: "GE Vernova Grid", url: "https://library.grid.gevernova.com/", tier: 1 },
      { label: "Bloom Energy Blog", url: "https://www.bloomenergy.com/blog/", tier: 1 },
      { label: "Oklo News", url: "https://oklo.com/newsroom/", tier: 1 },
    ],
  },

  // ---- Category 5: Research ----
  {
    name: "Research",
    tag: "research",
    filename: "blogs-research.yaml",
    blogs: [
      { label: "Harvard Kempner News", url: "https://kempnerinstitute.harvard.edu/news/", tier: 0 },
      { label: "Harvard Kempner Science of AI", url: "https://kempnerinstitute.harvard.edu/research/science-of-ai/", tier: 0 },
      { label: "Stanford HAI News", url: "https://hai.stanford.edu/news", tier: 0 },
      { label: "Stanford AI Index", url: "https://hai.stanford.edu/ai-index", tier: 0 },
      { label: "Stanford AI Lab", url: "https://ai.stanford.edu/", tier: 1 },
      { label: "MIT CSAIL News", url: "https://www.csail.mit.edu/news", tier: 1 },
      { label: "Berkeley AI Research Blog", url: "https://bair.berkeley.edu/blog/", tier: 1 },
      { label: "CMU AI", url: "https://ai.cmu.edu/research-and-policy-impact", tier: 1 },
      { label: "Princeton PLI Blog", url: "https://pli.princeton.edu/blog", tier: 1 },
      { label: "Oxford OATML Blog", url: "https://oatml.cs.ox.ac.uk/blog.html", tier: 1 },
      { label: "UCL AI Centre News", url: "https://www.ucl.ac.uk/engineering/ai-centre/news-events/centre-ai-news", tier: 1 },
      { label: "METR Blog", url: "https://metr.org/blog/", tier: 0 },
      { label: "Epoch AI", url: "https://epoch.ai/latest", tier: 0 },
      { label: "Center for AI Safety", url: "https://safe.ai/blog", tier: 1 },
      { label: "Apollo Research Blog", url: "https://www.apolloresearch.ai/blog/", tier: 1 },
      { label: "Redwood Research Blog", url: "https://blog.redwoodresearch.org/", tier: 1 },
      { label: "FAR.AI Blog", url: "https://far.ai/blog", tier: 1 },
      { label: "GovAI", url: "https://www.governance.ai/research", tier: 1 },
      { label: "Georgetown CSET", url: "https://cset.georgetown.edu/", tier: 1 },
      { label: "NIST AI", url: "https://www.nist.gov/artificial-intelligence", tier: 1 },
      { label: "Lilian Weng", url: "https://lilianweng.github.io/", tier: 1 },
      { label: "Simon Willison", url: "https://simonwillison.net/", tier: 1 },
      { label: "Chip Huyen", url: "https://huyenchip.com/blog/", tier: 1 },
      { label: "Eugene Yan", url: "https://eugeneyan.com/writing/", tier: 1 },
      { label: "Nathan Lambert / Interconnects", url: "https://www.interconnects.ai/", tier: 1 },
      { label: "Sebastian Raschka Blog", url: "https://sebastianraschka.com/blog/", tier: 1 },
      { label: "Jay Alammar", url: "https://jalammar.github.io/", tier: 1 },
      { label: "Andrej Karpathy", url: "https://karpathy.ai/", tier: 1 },
      { label: "Distill", url: "https://distill.pub/", tier: 1 },
      { label: "arXiv AI + CL", url: "https://arxiv.org/list/cs.AI/recent", tier: 1 },
      { label: "Papers with Code", url: "https://paperswithcode.com/", tier: 1 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

interface SourceEntry {
  id: string;
  url: string;
  label: string;
  kind: "rss";
  strategic_role: "industry_signal";
  health: "unknown";
  status: "active";
  tags: string[];
  feed_url: string | null;
  notes: string;
}

function buildSourceEntry(
  blog: BlogEntry,
  categoryTag: string,
  feedUrl: string | null,
): SourceEntry {
  const tierTag = blog.tier === 0 ? "tier_0" : "tier_1";
  return {
    id: `src-rss-${toSlug(blog.label)}`,
    url: blog.url,
    label: blog.label,
    kind: "rss",
    strategic_role: "industry_signal",
    health: "unknown",
    status: "active",
    tags: [categoryTag, tierTag],
    feed_url: feedUrl,
    notes: `${blog.label} — RSS feed for industry signal monitoring.`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sourcesDir = join(process.cwd(), "sources");

  const totalBlogs = CATEGORIES.reduce((n, c) => n + c.blogs.length, 0);
  console.log(`Registering ${totalBlogs} blog sources across ${CATEGORIES.length} categories.`);
  if (dryRun) console.log("(dry-run mode — no files will be written)\n");
  else console.log();

  let totalDiscovered = 0;
  let totalMissing = 0;

  for (const category of CATEGORIES) {
    console.log(`--- ${category.name} (${category.blogs.length} blogs) ---`);
    const entries: SourceEntry[] = [];

    for (const blog of category.blogs) {
      const slug = toSlug(blog.label);
      process.stdout.write(`  [${slug}] discovering feed... `);

      let feedUrl: string | null = null;
      try {
        feedUrl = await discoverFeedUrl(blog.url);
      } catch {
        // discovery failed — leave null
      }

      if (feedUrl) {
        console.log(`OK  ${feedUrl}`);
        totalDiscovered++;
      } else {
        console.log("MISS");
        totalMissing++;
      }

      entries.push(buildSourceEntry(blog, category.tag, feedUrl));
    }

    // Build YAML document
    const doc = {
      schema_version: "1",
      strategic_role: "industry_signal",
      sources: entries,
    };

    if (dryRun) {
      console.log(`  -> would write ${entries.length} entries to sources/${category.filename}\n`);
    } else {
      mkdirSync(sourcesDir, { recursive: true });
      const yamlContent = stringify(doc, { lineWidth: 120 });
      writeFileSync(join(sourcesDir, category.filename), yamlContent);
      console.log(`  -> wrote ${entries.length} entries to sources/${category.filename}\n`);
    }
  }

  // Summary
  console.log("=== Summary ===");
  console.log(`Total blogs:      ${totalBlogs}`);
  console.log(`Feeds discovered: ${totalDiscovered}`);
  console.log(`Feeds missing:    ${totalMissing}`);
  if (dryRun) console.log("\nDry run complete. No files were written.");
  else console.log("\nDone. Source files written to sources/.");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
