export interface ToolUsage {
  id: string;
  api_name: string;
  operation: string | null;
  campaign_id: string | null;
  credits_used: number | null;
  cost_usd: number | null;
  request_params: Record<string, unknown> | null;
  response_summary: string | null;
  results_count: number | null;
  duration_ms: number | null;
  success: boolean;
  error: string | null;
  recorded_at: string;
}

export interface LogToolUsageInput {
  api_name: string;
  operation: string;
  campaign_id?: string;
  credits_used?: number;
  cost_usd?: number;
  request_params?: Record<string, unknown>;
  response_summary?: string;
  results_count?: number;
  duration_ms?: number;
  success?: boolean;
  error?: string;
}

export interface AccountActivity {
  id: string;
  channel: string;
  action: string;
  account_id: string | null;
  message_id: string | null;
  recorded_at: string;
}

export interface LogActivityInput {
  channel: string;
  action: string;
  account_id: string;
  message_id?: string;
}

export const DAILY_LIMITS: Record<string, number> = {
  email: 50,
  linkedin_connection: 20,
  linkedin_dm: 40,
};
