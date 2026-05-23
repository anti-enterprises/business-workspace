#!/usr/bin/env tsx
/**
 * One-shot script: fetch all X/Twitter accounts you follow.
 *
 * Requires X_API_BEARER_TOKEN in .env.local (Basic tier or higher).
 *
 * Usage:
 *   npx tsx scripts/x-following.ts                    # table output
 *   npx tsx scripts/x-following.ts --json             # JSON output
 *   npx tsx scripts/x-following.ts --yaml             # YAML source entries
 *   npx tsx scripts/x-following.ts --username other    # fetch for a different user
 */

import dotenv from "dotenv";
import { getUserByUsername, getAllFollowing, type XUser } from "../execution/apis/x-twitter.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const DEFAULT_USERNAME = "jcervinoiv";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function printTable(users: XUser[]) {
  console.log(`\n${users.length} accounts followed:\n`);
  console.log("| # | Name | Username | Followers | Tweets |");
  console.log("|---|------|----------|-----------|--------|");
  users.forEach((u, i) => {
    const followers = u.public_metrics?.followers_count ?? 0;
    const tweets = u.public_metrics?.tweet_count ?? 0;
    console.log(`| ${i + 1} | ${u.name} | @${u.username} | ${followers.toLocaleString()} | ${tweets.toLocaleString()} |`);
  });
}

function printJson(users: XUser[]) {
  console.log(JSON.stringify(users, null, 2));
}

function printYaml(users: XUser[]) {
  for (const u of users) {
    const slug = toSlug(u.username);
    const desc = (u.description ?? "").split("\n")[0].slice(0, 100).replace(/"/g, '\\"');
    console.log(`  - id: src-x-${slug}`);
    console.log(`    url: https://x.com/${u.username}`);
    console.log(`    label: "${u.name} (@${u.username})"`);
    console.log(`    kind: social_platform`);
    console.log(`    strategic_role: industry_signal`);
    console.log(`    health: unknown`);
    console.log(`    status: pending`);
    console.log(`    notes: "${desc}"`);
    console.log();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const usernameIdx = args.indexOf("--username");
  const username = usernameIdx >= 0 ? args[usernameIdx + 1] : DEFAULT_USERNAME;
  const mode = args.find((a) => a.startsWith("--") && a !== "--username");

  if (!process.env.X_API_BEARER_TOKEN) {
    console.error("Missing X_API_BEARER_TOKEN in .env.local");
    console.error("\nGet a Bearer Token from https://developer.x.com/en/portal/dashboard");
    process.exit(1);
  }

  console.log(`Resolving @${username}...`);
  const user = await getUserByUsername(username);
  console.log(`Found: ${user.name} (@${user.username}) — ${user.public_metrics?.following_count ?? "?"} following\n`);

  console.log("Fetching following list...");
  const following = await getAllFollowing(user.id);

  if (mode === "--json") {
    printJson(following);
  } else if (mode === "--yaml") {
    printYaml(following);
  } else {
    printTable(following);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
