#!/usr/bin/env tsx
/**
 * One-shot script: fetch all YouTube subscriptions via OAuth 2.0.
 *
 * Setup (once):
 *   1. Go to https://console.cloud.google.com/apis/credentials
 *   2. Create OAuth 2.0 Client ID (type: Desktop app)
 *   3. Add to .env.local:
 *        YOUTUBE_OAUTH_CLIENT_ID=...
 *        YOUTUBE_OAUTH_CLIENT_SECRET=...
 *
 * Usage:
 *   npx tsx scripts/youtube-subscriptions.ts          # interactive OAuth + print subscriptions
 *   npx tsx scripts/youtube-subscriptions.ts --json    # output as JSON (pipe to jq, etc.)
 *   npx tsx scripts/youtube-subscriptions.ts --yaml    # output as YAML source entries
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { execFileSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const CLIENT_ID = process.env.YOUTUBE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
const SCOPES = "https://www.googleapis.com/auth/youtube.readonly";
const REDIRECT_PORT = 8914;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

interface Subscription {
  channelId: string;
  title: string;
  description: string;
}

// --- OAuth flow ---

function buildAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Authorization denied.</h2><p>You can close this tab.</p>");
        server.close();
        reject(new Error(`OAuth denied: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h2>Missing authorization code.</h2>");
        server.close();
        reject(new Error("No code in callback"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Authorized! You can close this tab.</h2><p>Fetching subscriptions...</p>");
      server.close();
      resolve(code);
    });

    server.listen(REDIRECT_PORT, () => {
      const authUrl = buildAuthUrl();
      console.log("\nOpening browser for Google authorization...\n");
      try {
        execFileSync("open", [authUrl], { stdio: "ignore" });
      } catch {
        console.log(`Open this URL manually:\n${authUrl}\n`);
      }
    });

    server.on("error", (err) => {
      reject(new Error(`Server error: ${err.message}. Is port ${REDIRECT_PORT} in use?`));
    });
  });
}

// --- Subscription fetching ---

async function fetchAllSubscriptions(accessToken: string): Promise<Subscription[]> {
  const subs: Subscription[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: "snippet",
      mine: "true",
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://www.googleapis.com/youtube/v3/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Subscriptions API error: ${err}`);
    }

    const data = (await res.json()) as {
      nextPageToken?: string;
      items?: Array<{
        snippet: {
          resourceId: { channelId: string };
          title: string;
          description: string;
        };
      }>;
    };

    for (const item of data.items ?? []) {
      subs.push({
        channelId: item.snippet.resourceId.channelId,
        title: item.snippet.title,
        description: item.snippet.description,
      });
    }

    pageToken = data.nextPageToken;
    if (pageToken) {
      console.error(`  Fetched ${subs.length} subscriptions so far...`);
    }
  } while (pageToken);

  return subs.sort((a, b) => a.title.localeCompare(b.title));
}

// --- Output formatters ---

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function printTable(subs: Subscription[]) {
  console.log(`\n${subs.length} subscriptions found:\n`);
  console.log("| # | Channel | Channel ID |");
  console.log("|---|---------|------------|");
  subs.forEach((s, i) => {
    console.log(`| ${i + 1} | ${s.title} | ${s.channelId} |`);
  });
}

function printJson(subs: Subscription[]) {
  console.log(JSON.stringify(subs, null, 2));
}

function printYaml(subs: Subscription[]) {
  for (const s of subs) {
    const slug = toSlug(s.title);
    const desc = s.description.split("\n")[0].slice(0, 100);
    console.log(`  - id: src-yt-${slug}`);
    console.log(`    url: https://www.youtube.com/channel/${s.channelId}`);
    console.log(`    label: "${s.title}"`);
    console.log(`    kind: youtube`);
    console.log(`    strategic_role: trust_network`);
    console.log(`    health: unknown`);
    console.log(`    status: pending`);
    console.log(`    channel_id: ${s.channelId}`);
    console.log(`    notes: "${desc}"`);
    console.log();
  }
}

// --- Main ---

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing YOUTUBE_OAUTH_CLIENT_ID or YOUTUBE_OAUTH_CLIENT_SECRET in .env.local");
    console.error("\nSetup:");
    console.error("  1. Go to https://console.cloud.google.com/apis/credentials");
    console.error("  2. Create OAuth 2.0 Client ID (type: Desktop app)");
    console.error("  3. Add to .env.local:");
    console.error("       YOUTUBE_OAUTH_CLIENT_ID=your-client-id");
    console.error("       YOUTUBE_OAUTH_CLIENT_SECRET=your-client-secret");
    process.exit(1);
  }

  const code = await waitForAuthCode();
  console.log("Authorization received. Exchanging for access token...");

  const accessToken = await exchangeCode(code);
  console.log("Access token obtained. Fetching subscriptions...\n");

  const subs = await fetchAllSubscriptions(accessToken);

  const mode = process.argv[2];
  if (mode === "--json") {
    printJson(subs);
  } else if (mode === "--yaml") {
    printYaml(subs);
  } else {
    printTable(subs);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
