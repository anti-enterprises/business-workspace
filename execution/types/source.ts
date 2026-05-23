import { z } from "zod/v4";

export const SOURCE_KINDS = [
  "youtube",
  "web_page",
  "social_platform",
  "review_aggregator",
  "newsletter",
  "rss",
  "reddit",
] as const;

export const STRATEGIC_ROLES = [
  "trust_network",
  "community_forum",
  "review_aggregator",
  "industry_signal",
  "direct_competitor",
  "substitute",
  "complementary",
] as const;

export const HEALTH_VALUES = ["healthy", "warning", "failing", "degraded", "unknown"] as const;
export const STATUS_VALUES = ["active", "pending", "paused", "archived"] as const;

export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const StrategicRole = z.enum(STRATEGIC_ROLES);
export type StrategicRole = z.infer<typeof StrategicRole>;

export const SourceHealth = z.enum(HEALTH_VALUES);
export type SourceHealth = z.infer<typeof SourceHealth>;

export const SourceStatus = z.enum(STATUS_VALUES);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const SpaExtraction = z.object({
  enabled: z.boolean().default(false),
  post_link_pattern: z.string().optional(),
  exclude_pattern: z.string().optional(),
  max_posts_per_run: z.number().int().positive().default(10),
  post_age_days: z.number().int().positive().default(14),
});
export type SpaExtraction = z.infer<typeof SpaExtraction>;

export const Source = z.object({
  id: z.string(),
  url: z.string().nullable().optional(),
  label: z.string(),
  kind: SourceKind,
  strategic_role: StrategicRole,
  health: SourceHealth.default("unknown"),
  status: SourceStatus.default("active"),
  notes: z.string().optional(),
  sender: z.string().optional(),
  channel_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  feed_url: z.string().nullable().optional(),
  spa_extraction: SpaExtraction.optional(),
});
export type Source = z.infer<typeof Source>;

export const RepoSourceFile = z.object({
  schema_version: z.string().default("1"),
  strategic_role: StrategicRole,
  sources: z.array(Source),
});
export type RepoSourceFile = z.infer<typeof RepoSourceFile>;

export const PulseSourceFile = z.object({
  schema_version: z.string().default("1"),
  typed_at: z.string().optional(),
  sources: z.array(Source),
});
export type PulseSourceFile = z.infer<typeof PulseSourceFile>;

// Role -> filename mapping
export const ROLE_FILENAMES: Record<StrategicRole, string> = {
  trust_network: "trust-network.yaml",
  community_forum: "community-forums.yaml",
  review_aggregator: "review-aggregators.yaml",
  industry_signal: "industry-signals.yaml",
  direct_competitor: "competitors.yaml",
  substitute: "substitutes.yaml",
  complementary: "complementary.yaml",
};

// Repo wins for curated fields, Pulse wins for auto-managed fields
const REPO_WINS = ["url", "label", "kind", "strategic_role", "notes", "status", "sender", "channel_id", "tags", "feed_url", "spa_extraction"] as const;
const PULSE_WINS = ["health"] as const;

export interface MergeResult {
  merged: Source[];
  added: number;
  updated: number;
  unchanged: number;
}

export function mergeSources(
  repoSources: Map<string, Source>,
  pulseSources: Map<string, Source>,
): MergeResult {
  const merged = new Map<string, Source>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  // Process Pulse sources
  for (const [id, ps] of pulseSources) {
    const rs = repoSources.get(id);
    if (rs) {
      const result = { ...ps } as Record<string, unknown>;
      for (const f of REPO_WINS) {
        if (f in rs) result[f] = rs[f as keyof Source];
      }
      for (const f of PULSE_WINS) {
        if (f in ps) result[f] = ps[f as keyof Source];
      }
      const changed = REPO_WINS.some(
        (f) => rs[f as keyof Source] !== ps[f as keyof Source],
      ) || PULSE_WINS.some(
        (f) => rs[f as keyof Source] !== ps[f as keyof Source],
      );
      if (changed) updated++;
      else unchanged++;
      merged.set(id, result as Source);
    } else {
      added++;
      merged.set(id, ps);
    }
  }

  // Add repo-only sources
  for (const [id, rs] of repoSources) {
    if (!merged.has(id)) {
      added++;
      merged.set(id, rs);
    }
  }

  return { merged: [...merged.values()], added, updated, unchanged };
}
