#!/usr/bin/env tsx
/**
 * Parse X/Twitter data export archive.
 *
 * X archives contain JS files (not JSON) with a window.YTD prefix.
 * This script extracts following list and repost history.
 *
 * Usage:
 *   npx tsx scripts/x-data-export.ts path/to/twitter-*.zip --following   # who you follow
 *   npx tsx scripts/x-data-export.ts path/to/twitter-*.zip --reposts     # your retweets
 *   npx tsx scripts/x-data-export.ts path/to/twitter-*.zip --yaml        # following as YAML source entries
 *   npx tsx scripts/x-data-export.ts path/to/twitter-*.zip --json        # following as JSON
 */

import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";

// --- Archive parsing ---

interface ArchiveFollowing {
  following: {
    accountId: string;
    userLink: string;
  };
}

interface ArchiveTweet {
  tweet: {
    id: string;
    full_text: string;
    created_at: string;
    entities?: {
      urls?: Array<{ expanded_url: string }>;
      user_mentions?: Array<{ screen_name: string }>;
    };
  };
}

/**
 * Strip the window.YTD.xxx.partN = prefix from X archive JS files.
 */
function parseArchiveJs<T>(content: string): T[] {
  const jsonStart = content.indexOf("[");
  if (jsonStart === -1) return [];
  return JSON.parse(content.slice(jsonStart)) as T[];
}

function extractFromZip(zipPath: string, innerPath: string, tmpDir: string): string {
  mkdirSync(tmpDir, { recursive: true });
  try {
    execFileSync("unzip", ["-o", "-j", zipPath, innerPath, "-d", tmpDir], { stdio: "pipe" });
  } catch {
    throw new Error(`Could not extract ${innerPath} from archive`);
  }
  const filename = innerPath.split("/").pop()!;
  const extracted = join(tmpDir, filename);
  if (!existsSync(extracted)) throw new Error(`File not found after extraction: ${extracted}`);
  return readFileSync(extracted, "utf-8");
}

// --- Formatters ---

interface FollowingEntry {
  accountId: string;
  username: string;
}

interface RepostEntry {
  id: string;
  text: string;
  date: string;
  originalAuthor: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function printFollowingTable(entries: FollowingEntry[]) {
  console.log(`\n${entries.length} accounts followed:\n`);
  console.log("| # | Username | Account ID |");
  console.log("|---|----------|------------|");
  entries.forEach((e, i) => {
    console.log(`| ${i + 1} | @${e.username} | ${e.accountId} |`);
  });
}

function printFollowingYaml(entries: FollowingEntry[]) {
  for (const e of entries) {
    const slug = toSlug(e.username);
    console.log(`  - id: src-x-${slug}`);
    console.log(`    url: https://x.com/${e.username}`);
    console.log(`    label: "@${e.username}"`);
    console.log(`    kind: social_platform`);
    console.log(`    strategic_role: industry_signal`);
    console.log(`    health: unknown`);
    console.log(`    status: pending`);
    console.log(`    notes: "Imported from X data export"`);
    console.log();
  }
}

function printFollowingJson(entries: FollowingEntry[]) {
  console.log(JSON.stringify(entries, null, 2));
}

function printRepostsTable(reposts: RepostEntry[]) {
  console.log(`\n${reposts.length} reposts found:\n`);
  console.log("| # | Date | Original Author | Text (preview) |");
  console.log("|---|------|-----------------|----------------|");
  reposts.forEach((r, i) => {
    const preview = r.text.slice(4 + r.originalAuthor.length + 2, 80).replace(/\n/g, " ");
    console.log(`| ${i + 1} | ${r.date} | @${r.originalAuthor} | ${preview}... |`);
  });
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  const zipPath = args.find((a) => !a.startsWith("--"));
  const mode = args.find((a) => a.startsWith("--"));

  if (!zipPath) {
    console.error("Usage: npx tsx scripts/x-data-export.ts <archive.zip> [--following|--reposts|--yaml|--json]");
    process.exit(1);
  }

  const tmpDir = join(process.env.TMPDIR ?? "/tmp", "pulse-x-export");

  if (mode === "--reposts") {
    console.log("Extracting repost history...");
    const tweetsJs = extractFromZip(zipPath, "data/tweets.js", tmpDir);
    const tweets = parseArchiveJs<ArchiveTweet>(tweetsJs);

    const reposts: RepostEntry[] = tweets
      .filter((t) => t.tweet.full_text.startsWith("RT @"))
      .map((t) => {
        const match = t.tweet.full_text.match(/^RT @(\w+):/);
        return {
          id: t.tweet.id,
          text: t.tweet.full_text,
          date: new Date(t.tweet.created_at).toISOString().split("T")[0],
          originalAuthor: match?.[1] ?? "unknown",
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    printRepostsTable(reposts);
  } else {
    console.log("Extracting following list...");
    const followingJs = extractFromZip(zipPath, "data/following.js", tmpDir);
    const raw = parseArchiveJs<ArchiveFollowing>(followingJs);

    const entries: FollowingEntry[] = raw
      .map((r) => {
        const match = r.following.userLink.match(/\/([a-zA-Z0-9_]+)\/?$/);
        return {
          accountId: r.following.accountId,
          username: match?.[1] ?? r.following.accountId,
        };
      })
      .sort((a, b) => a.username.localeCompare(b.username));

    if (mode === "--yaml") {
      printFollowingYaml(entries);
    } else if (mode === "--json") {
      printFollowingJson(entries);
    } else {
      printFollowingTable(entries);
    }
  }

  // Cleanup
  rmSync(tmpDir, { recursive: true, force: true });
}

main();
