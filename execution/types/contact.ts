export const SENIORITY_LEVELS = [
  "c_suite",
  "vp",
  "director",
  "manager",
  "individual",
] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export interface Contact {
  id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  email_verified: boolean;
  email_verification_date: string | null;
  email_verification_source: string | null;
  phone: string | null;
  phone_type: string | null;
  linkedin_url: string | null;
  linkedin_connected: boolean;
  title: string | null;
  seniority: Seniority | null;
  department: string | null;
  enrichment_data: Record<string, unknown> | null;
  source_api: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertContactInput {
  company_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  email_verified?: boolean;
  email_verification_date?: string;
  email_verification_source?: string;
  phone?: string;
  phone_type?: string;
  linkedin_url?: string;
  linkedin_connected?: boolean;
  title?: string;
  seniority?: Seniority;
  department?: string;
  enrichment_data?: Record<string, unknown>;
  source_api?: string;
}

export const CAMPAIGN_CONTACT_STATUSES = [
  "pending",
  "active",
  "replied",
  "meeting_booked",
  "proposal_sent",
  "negotiating",
  "closed_won",
  "closed_lost",
  "opted_out",
  "bounced",
  "completed",
] as const;
export type CampaignContactStatus =
  (typeof CAMPAIGN_CONTACT_STATUSES)[number];

export interface CampaignContact {
  id: string;
  campaign_id: string;
  contact_id: string;
  sequence_step: number;
  status: CampaignContactStatus;
  deal_value: number | null;
  meeting_booked_at: string | null;
  proposal_sent_at: string | null;
  closed_at: string | null;
  added_at: string;
  last_contacted_at: string | null;
}

export interface CampaignContactWithDetails extends CampaignContact {
  contacts?: Contact & {
    companies?: import("./company.js").Company;
  };
}
