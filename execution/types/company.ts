export interface SignalData {
  signal_type?: string;
  signal_strength?: "strong" | "moderate" | "weak" | "none";
  technologies_matched?: string[];
  published_date?: string;
  summary?: string;
  highlights?: string[];
  [key: string]: unknown;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employee_count: number | null;
  employee_count_range: string | null;
  revenue_range: string | null;
  founded_year: number | null;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  tech_stack: string[] | null;
  signals_found: SignalData | null;
  fit_score: number | null;
  fit_notes: string | null;
  disqualified: boolean;
  disqualification_reason: string | null;
  enrichment_data: Record<string, unknown> | null;
  source_api: string | null;
  source_campaign_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertCompanyInput {
  name: string;
  domain: string;
  website?: string;
  industry?: string;
  employee_count?: number;
  employee_count_range?: string;
  revenue_range?: string;
  founded_year?: number;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  tech_stack?: string[];
  signals_found?: SignalData;
  fit_score?: number;
  fit_notes?: string;
  disqualified?: boolean;
  disqualification_reason?: string;
  enrichment_data?: Record<string, unknown>;
  source_api?: string;
  source_campaign_id?: string;
}
