import { query, queryOne, queryMany } from "./client.js";
import type {
  ToolUsage,
  LogToolUsageInput,
  AccountActivity,
  LogActivityInput,
} from "../types/api.js";

interface InsertField<T> {
  column: string;
  read: (input: T) => unknown;
  json?: boolean;
}

const TOOL_USAGE_INSERT_FIELDS: InsertField<LogToolUsageInput>[] = [
  { column: "api_name", read: (input) => input.api_name },
  { column: "operation", read: (input) => input.operation },
  { column: "campaign_id", read: (input) => input.campaign_id },
  { column: "credits_used", read: (input) => input.credits_used },
  { column: "cost_usd", read: (input) => input.cost_usd },
  { column: "request_params", read: (input) => input.request_params, json: true },
  { column: "response_summary", read: (input) => input.response_summary },
  { column: "results_count", read: (input) => input.results_count },
  { column: "duration_ms", read: (input) => input.duration_ms },
  { column: "success", read: (input) => input.success },
  { column: "error", read: (input) => input.error },
];

const ACTIVITY_INSERT_FIELDS: InsertField<LogActivityInput>[] = [
  { column: "channel", read: (input) => input.channel },
  { column: "action", read: (input) => input.action },
  { column: "account_id", read: (input) => input.account_id },
  { column: "message_id", read: (input) => input.message_id },
];

function buildInsert<T>(
  input: T,
  fields: InsertField<T>[],
): { columns: string[]; placeholders: string[]; values: unknown[] } {
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const field of fields) {
    const rawValue = field.read(input);
    if (rawValue === undefined) continue;

    columns.push(field.column);
    placeholders.push(`$${paramIndex}`);
    values.push(field.json ? JSON.stringify(rawValue) : rawValue);
    paramIndex++;
  }

  return { columns, placeholders, values };
}

export async function logToolUsage(input: LogToolUsageInput): Promise<ToolUsage> {
  const { columns, placeholders, values } = buildInsert(
    input,
    TOOL_USAGE_INSERT_FIELDS,
  );

  const result = await query<ToolUsage>(
    `INSERT INTO tool_usage (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function getCampaignCosts(
  campaignId: string,
): Promise<
  {
    api_name: string;
    api_calls: number;
    total_credits: number;
    total_cost_usd: number;
    total_results: number;
  }[]
> {
  return queryMany(
    `SELECT
       api_name,
       COUNT(*)::int AS api_calls,
       COALESCE(SUM(credits_used), 0)::numeric AS total_credits,
       COALESCE(SUM(cost_usd), 0)::numeric AS total_cost_usd,
       COALESCE(SUM(results_count), 0)::int AS total_results
     FROM tool_usage
     WHERE campaign_id = $1
     GROUP BY api_name`,
    [campaignId]
  );
}

export async function logActivity(input: LogActivityInput): Promise<AccountActivity> {
  const { columns, placeholders, values } = buildInsert(
    input,
    ACTIVITY_INSERT_FIELDS,
  );

  const result = await query<AccountActivity>(
    `INSERT INTO account_activity (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function getDailySendCount(
  accountId: string,
  channel: string,
  date?: Date,
): Promise<number> {
  const targetDate = date ?? new Date();
  const dayStart = new Date(targetDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM account_activity
     WHERE account_id = $1
       AND channel = $2
      AND action IN ('send', 'connect', 'message')
      AND recorded_at >= $3
      AND recorded_at <= $4`,
    [accountId, channel, dayStart.toISOString(), dayEnd.toISOString()],
  );

  return parseInt(result?.count ?? "0", 10);
}
