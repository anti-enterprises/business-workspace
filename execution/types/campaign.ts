export const SIGNAL_TYPES = [
  "hiring",
  "tech_stack",
  "funding",
  "growth",
  "news",
  "firmographic",
  "custom",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const MESSAGING_FRAMEWORKS = ["pvp", "use_case_driven"] as const;
export type MessagingFramework = (typeof MESSAGING_FRAMEWORKS)[number];

export const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface SignalConfig {
  job_titles?: string[];
  keywords?: string | string[];
  technologies?: string[];
  industry?: string;
  company_size_min?: number;
  company_size_max?: number;
  employee_count_min?: number;
  employee_count_max?: number;
  country?: string;
  location?: string;
  vertical?: string;
  funding_stage?: string;
  days_back?: number;
  posted_after?: string;
  query?: string;
  start_date?: string;
  category?: string;
  revenue_min?: number;
  revenue_max?: number;
  limit?: number;
}

export interface Campaign {
  id: string;
  offer_id: string;
  slug: string;
  name: string;
  signal_type: SignalType | null;
  signal_config: SignalConfig | null;
  messaging_framework: MessagingFramework | null;
  copy_variants: Record<string, unknown> | null;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
}

export interface CampaignWithOffer extends Campaign {
  offers?: {
    id: string;
    slug: string;
    name: string;
    icp: Record<string, unknown> | null;
    positioning: Record<string, unknown> | null;
  };
}

export interface CreateCampaignInput {
  offer_id: string;
  slug: string;
  name: string;
  signal_type?: SignalType;
  signal_config?: SignalConfig;
  messaging_framework?: MessagingFramework;
}

export interface UpdateCampaignInput {
  name?: string;
  signal_type?: SignalType;
  signal_config?: SignalConfig;
  messaging_framework?: MessagingFramework;
  copy_variants?: Record<string, unknown>;
  status?: CampaignStatus;
}
