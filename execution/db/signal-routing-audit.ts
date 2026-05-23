import { query, queryMany } from "./client.js";
import type {
  LogSignalRoutingAuditInput,
  SignalRoutingAudit,
} from "../types/signal-routing.js";

interface InsertField<T> {
  column: string;
  read: (input: T) => unknown;
  json?: boolean;
}

const SIGNAL_ROUTING_AUDIT_FIELDS: InsertField<LogSignalRoutingAuditInput>[] = [
  { column: "campaign_id", read: (input) => input.campaign_id },
  { column: "signal_type", read: (input) => input.signal_type },
  { column: "decision", read: (input) => input.decision },
  { column: "reason", read: (input) => input.reason },
  { column: "candidate_domain", read: (input) => input.candidate_domain },
  { column: "company_domain", read: (input) => input.company_domain },
  { column: "source_api", read: (input) => input.source_api },
  { column: "result_url", read: (input) => input.result_url },
  { column: "result_title", read: (input) => input.result_title },
  { column: "payload", read: (input) => input.payload, json: true },
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

export async function logSignalRoutingAudit(
  input: LogSignalRoutingAuditInput,
): Promise<SignalRoutingAudit> {
  const { columns, placeholders, values } = buildInsert(
    input,
    SIGNAL_ROUTING_AUDIT_FIELDS,
  );

  const result = await query<SignalRoutingAudit>(
    `INSERT INTO signal_routing_audit (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function getSignalRoutingAuditForCampaign(
  campaignId: string,
): Promise<SignalRoutingAudit[]> {
  return queryMany<SignalRoutingAudit>(
    `SELECT *
     FROM signal_routing_audit
     WHERE campaign_id = $1
     ORDER BY recorded_at DESC`,
    [campaignId],
  );
}
