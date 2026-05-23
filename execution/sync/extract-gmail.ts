import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { RepoSourceFile } from "../types/source.js";

const REPO_SOURCES_DIR = join(process.cwd(), "sources");

// --- Gmail label configuration ---

export const GMAIL_LABELS = {
  newsletters: "Pulse/Newsletters",
  upwork: "UpWork",
} as const;

export type GmailLabelKey = keyof typeof GMAIL_LABELS;

// --- Types ---

export interface GmailSource {
  id: string;
  label: string;
  sender: string | null;
  gmailLabel: string;
  strategic_role: string;
  tags?: string[];
  notes?: string;
}

// --- Source loading ---

/**
 * Load Gmail-extractable sources from repo YAML files.
 * Newsletter sources use the Pulse/Newsletters label.
 * Returns sources grouped by Gmail label.
 */
export function loadGmailSources(): Map<string, GmailSource[]> {
  const byLabel = new Map<string, GmailSource[]>();

  if (!existsSync(REPO_SOURCES_DIR)) return byLabel;

  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));

  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    for (const source of parsed.sources) {
      if (source.status !== "active") continue;

      let gmailLabel: string | null = null;

      if (source.kind === "newsletter") {
        gmailLabel = GMAIL_LABELS.newsletters;
      }

      if (!gmailLabel) continue;

      const list = byLabel.get(gmailLabel) ?? [];
      list.push({
        id: source.id,
        label: source.label,
        sender: source.sender ?? null,
        gmailLabel,
        strategic_role: source.strategic_role,
        tags: source.tags,
        notes: source.notes,
      });
      byLabel.set(gmailLabel, list);
    }
  }

  return byLabel;
}

/**
 * Load newsletter sources specifically.
 */
export function loadNewsletterSources(): GmailSource[] {
  const byLabel = loadGmailSources();
  return byLabel.get(GMAIL_LABELS.newsletters) ?? [];
}

// --- Query builders ---

/**
 * Build a Gmail search query for a specific label.
 * Optionally filters by sender addresses from sources.
 */
export function buildGmailQuery(
  gmailLabel: string,
  options: { senders?: string[]; newerThan?: string } = {},
): string {
  const { newerThan = "7d" } = options;

  const senderClause = options.senders?.length
    ? `(${options.senders.map((s) => `from:${s}`).join(" OR ")})`
    : "";

  const parts = [
    `label:${gmailLabel}`,
    `newer_than:${newerThan}`,
    senderClause,
  ].filter(Boolean);

  return parts.join(" ");
}

/**
 * Build query for newsletter extraction.
 */
export function buildNewsletterQuery(
  sources?: GmailSource[],
  newerThan = "7d",
): string {
  const senders = sources
    ?.filter((s) => s.sender)
    .map((s) => s.sender!) ?? [];

  return buildGmailQuery(GMAIL_LABELS.newsletters, { senders, newerThan });
}

/**
 * Build query for UpWork job-post-pattern analysis. Scoped to alert
 * emails from donotreply@upwork.com whose subject begins with "New Job"
 * (single-job alerts) or "Jobs posted in the last 24 hours" (daily
 * digests). Deliberately excludes client messages, invitations to
 * apply, billing, and other transactional UpWork mail.
 */
export function buildUpworkQuery(newerThan = "7d"): string {
  const sender = "from:donotreply@upwork.com";
  const subjects = `(subject:"New Job" OR subject:"Jobs posted in the last 24 hours")`;
  return `${sender} ${subjects} newer_than:${newerThan}`;
}
