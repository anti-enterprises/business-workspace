export const PERIOD_PRESETS = [
  "last_7d",
  "last_30d",
  "last_90d",
  "this_week",
  "this_month",
  "this_quarter",
  "all_time",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export type PeriodInput = PeriodPreset | { from: Date; to: Date };

export interface ResolvedPeriod {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date } | null;
  preset: string;
}

export interface KPIResult<T> {
  period: { from: Date; to: Date; preset: string };
  current: T;
  previous: T | null;
  delta: Partial<T> | null;
  delta_pct: Partial<T> | null;
}

// --- Sales Pipeline ---

export interface SalesPipelineMetrics {
  funnel: {
    pending: number;
    active: number;
    replied: number;
    meeting_booked: number;
    proposal_sent: number;
    negotiating: number;
    closed_won: number;
    closed_lost: number;
  };
  conversion_rates: {
    active_to_replied: number;
    replied_to_meeting: number;
    meeting_to_proposal: number;
    proposal_to_negotiating: number;
    negotiating_to_closed_won: number;
    overall_win_rate: number;
  };
  velocity: {
    avg_days_to_reply: number | null;
    avg_days_to_meeting: number | null;
    avg_days_to_close: number | null;
  };
  pipeline_value: {
    total_open: number;
    total_closed_won: number;
    avg_deal_size: number | null;
  };
}

// --- Marketing ---

export interface ChannelMetrics {
  sent: number;
  opened: number;
  replied: number;
  open_rate: number;
  reply_rate: number;
}

export interface VariantMetrics extends ChannelMetrics {
  sample_size_sufficient: boolean;
}

export interface SignalTypeMetrics {
  contacts: number;
  replied: number;
  meetings: number;
  reply_rate: number;
}

export interface SequenceStepMetrics {
  sent: number;
  opened: number;
  replied: number;
  reply_rate: number;
}

export interface MarketingMetrics {
  volume: {
    contacts_reached: number;
    messages_sent: number;
    messages_opened: number;
    messages_replied: number;
  };
  rates: {
    open_rate: number;
    reply_rate: number;
    positive_sentiment_rate: number;
  };
  by_channel: Record<string, ChannelMetrics>;
  by_variant: Record<string, VariantMetrics>;
  by_signal_type: Record<string, SignalTypeMetrics>;
  cost: {
    total_usd: number;
    cost_per_reply: number;
    cost_per_meeting: number;
    by_api: Array<{ api_name: string; calls: number; cost_usd: number }>;
  };
  by_sequence_step: Record<number, SequenceStepMetrics>;
}

// --- Options ---

export interface SalesKPIOptions {
  period: PeriodInput;
  campaignId?: string;
  offerId?: string;
}

export interface MarketingKPIOptions {
  period: PeriodInput;
  campaignId?: string;
  offerId?: string;
  channel?: string;
}
