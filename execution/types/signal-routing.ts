export const SIGNAL_ROUTING_DECISIONS = ["accepted", "skipped"] as const;
export type SignalRoutingDecision = (typeof SIGNAL_ROUTING_DECISIONS)[number];

export interface SignalRoutingAudit {
  id: string;
  campaign_id: string | null;
  signal_type: string;
  decision: SignalRoutingDecision;
  reason: string | null;
  candidate_domain: string | null;
  company_domain: string | null;
  source_api: string | null;
  result_url: string | null;
  result_title: string | null;
  payload: Record<string, unknown> | null;
  recorded_at: string;
}

export interface LogSignalRoutingAuditInput {
  campaign_id?: string;
  signal_type: string;
  decision: SignalRoutingDecision;
  reason?: string;
  candidate_domain?: string;
  company_domain?: string;
  source_api?: string;
  result_url?: string;
  result_title?: string;
  payload?: Record<string, unknown>;
}
