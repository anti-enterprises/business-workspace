import { execFileSync } from "child_process";
import { readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { RepoSourceFile } from "../types/source.js";
import { getUploadsAfter, type VideoInfo } from "../apis/youtube.js";

const REPO_SOURCES_DIR = join(process.cwd(), "sources");
const YTDLP_BIN = process.env.YTDLP_BIN ?? "yt-dlp";
const TRANSCRIPT_TMPDIR = join(process.env.TMPDIR ?? "/tmp", "pulse-yt-transcripts");

// --- Types ---

export interface YouTubeSource {
  id: string;
  label: string;
  channelId: string;
  strategic_role: string;
  notes?: string;
}

export interface VideoWithTranscript {
  sourceId: string;
  sourceLabel: string;
  video: VideoInfo;
  transcript: string | null;
}

// --- Source loading ---

/**
 * Load all YouTube sources from repo YAML files.
 * Returns sources with kind: "youtube" that have a channel_id.
 */
export function loadYouTubeSources(): YouTubeSource[] {
  if (!existsSync(REPO_SOURCES_DIR)) return [];

  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));
  const channels: YouTubeSource[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    for (const source of parsed.sources) {
      if (source.kind === "youtube" && source.status === "active" && source.channel_id) {
        channels.push({
          id: source.id,
          label: source.label,
          channelId: source.channel_id,
          strategic_role: source.strategic_role,
          notes: source.notes,
        });
      }
    }
  }

  return channels;
}

// --- VTT cleaning ---

/**
 * Strip VTT timing, positioning, and inline tags to produce clean text.
 * Deduplicates repeated lines (YouTube auto-captions repeat the previous segment).
 */
export function cleanVtt(vtt: string): string {
  const lines = vtt.split("\n");
  const textLines: string[] = [];
  let prevLine = "";

  for (const raw of lines) {
    const line = raw.trim();

    // Skip VTT header, timestamps, empty lines, and positioning metadata
    if (
      line === "WEBVTT" ||
      line.startsWith("Kind:") ||
      line.startsWith("Language:") ||
      line === "" ||
      /^\d{2}:\d{2}/.test(line)
    ) continue;

    // Strip inline timing tags: <00:00:00.240><c> word</c>
    const cleaned = line
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
      .replace(/<\/?c>/g, "")
      .trim();

    if (!cleaned) continue;

    // Deduplicate: YouTube auto-captions repeat the full previous segment
    if (cleaned === prevLine) continue;
    prevLine = cleaned;

    textLines.push(cleaned);
  }

  return textLines.join(" ");
}

// --- Transcript download ---

/**
 * Download auto-generated transcript for a single video via yt-dlp.
 * Returns cleaned plain text, or null if no captions available.
 */
export function downloadTranscript(videoId: string): string | null {
  mkdirSync(TRANSCRIPT_TMPDIR, { recursive: true });
  const outPath = join(TRANSCRIPT_TMPDIR, videoId);
  const vttPath = `${outPath}.en.vtt`;

  // Clean up any previous attempt
  if (existsSync(vttPath)) rmSync(vttPath);

  try {
    execFileSync(YTDLP_BIN, [
      "--write-auto-sub",
      "--sub-lang", "en",
      "--sub-format", "vtt",
      "--skip-download",
      "--no-warnings",
      "-o", outPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 30000, stdio: "pipe" });
  } catch {
    return null;
  }

  if (!existsSync(vttPath)) return null;

  const vtt = readFileSync(vttPath, "utf-8");
  rmSync(vttPath);
  return cleanVtt(vtt);
}

// --- Extraction pipeline ---

/**
 * Extract recent videos + transcripts for all active YouTube sources.
 * Used during manual Pulse weekly runs.
 *
 * @param daysBack - How many days back to fetch (default: 7)
 * @param withTranscripts - Whether to download transcripts via yt-dlp (default: true)
 */
export async function extractYouTubeSources(
  daysBack = 7,
  withTranscripts = true,
): Promise<VideoWithTranscript[]> {
  const sources = loadYouTubeSources();
  if (sources.length === 0) {
    console.log("No active YouTube sources with channel_id found.");
    return [];
  }

  const after = new Date(Date.now() - daysBack * 86400000);
  const results: VideoWithTranscript[] = [];

  for (const source of sources) {
    console.log(`\nFetching uploads for ${source.label} (${source.channelId})...`);

    try {
      const videos = await getUploadsAfter(source.channelId, after);
      console.log(`  Found ${videos.length} videos in last ${daysBack} days`);

      for (const video of videos) {
        let transcript: string | null = null;

        if (withTranscripts) {
          console.log(`  Downloading transcript: ${video.title}`);
          transcript = downloadTranscript(video.videoId);
          if (transcript) {
            console.log(`    Transcript: ${transcript.length} chars`);
          } else {
            console.log(`    No transcript available`);
          }
        }

        results.push({
          sourceId: source.id,
          sourceLabel: source.label,
          video,
          transcript,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error fetching ${source.label}: ${msg}`);
    }
  }

  return results;
}

// --- CLI entrypoint ---

if (process.argv[1]?.endsWith("extract-youtube.ts") || process.argv[1]?.endsWith("extract-youtube.js")) {
  const daysBack = parseInt(process.argv[2] ?? "7", 10);
  const skipTranscripts = process.argv.includes("--no-transcripts");

  extractYouTubeSources(daysBack, !skipTranscripts)
    .then((results) => {
      console.log(`\n--- Summary ---`);
      console.log(`Total videos: ${results.length}`);
      console.log(`With transcripts: ${results.filter((r) => r.transcript).length}`);
      for (const r of results) {
        console.log(`  [${r.sourceLabel}] ${r.video.title} (${r.video.publishedAt.split("T")[0]})`);
      }
    })
    .catch((err) => {
      console.error("Extraction failed:", err);
      process.exit(1);
    });
}
