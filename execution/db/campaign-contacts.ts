import { queryOne, queryMany } from "./client.js";
import type {
  CampaignContact,
  CampaignContactWithDetails,
  CampaignContactStatus,
} from "../types/contact.js";
import type { MessageStatus } from "../types/message.js";

const LOCKED_TERMINAL_STATUSES: Set<CampaignContactStatus> = new Set([
  "meeting_booked",
  "proposal_sent",
  "negotiating",
  "closed_won",
  "closed_lost",
  "opted_out",
]);

type MessageLifecycleAggregate = {
  total_messages: number;
  replied_count: number;
  bounced_count: number;
  in_flight_count: number;
};

export async function addContactToCampaign(
  campaignId: string,
  contactId: string,
): Promise<CampaignContact> {
  const existing = await queryOne<CampaignContact>(
    "SELECT * FROM campaign_contacts WHERE campaign_id = $1 AND contact_id = $2",
    [campaignId, contactId],
  );

  if (existing) return existing;

  return (await queryOne<CampaignContact>(
    `INSERT INTO campaign_contacts (campaign_id, contact_id)
     VALUES ($1, $2)
     RETURNING *`,
    [campaignId, contactId],
  ))!;
}

export async function getCampaignContacts(
  campaignId: string,
  status?: string,
): Promise<CampaignContactWithDetails[]> {
  const conditions = ["cc.campaign_id = $1"];
  const values: unknown[] = [campaignId];

  if (status) {
    conditions.push("cc.status = $2");
    values.push(status);
  }

  const rows = await queryMany<Record<string, unknown>>(
    `SELECT
       cc.id, cc.campaign_id, cc.contact_id, cc.sequence_step,
       cc.status, cc.deal_value, cc.meeting_booked_at, cc.proposal_sent_at,
       cc.closed_at, cc.added_at, cc.last_contacted_at,
       co.id AS co_id, co.company_id AS co_company_id,
       co.first_name AS co_first_name, co.last_name AS co_last_name,
       co.full_name AS co_full_name, co.email AS co_email,
       co.email_verified AS co_email_verified,
       co.email_verification_date AS co_email_verification_date,
       co.email_verification_source AS co_email_verification_source,
       co.phone AS co_phone, co.phone_type AS co_phone_type,
       co.linkedin_url AS co_linkedin_url,
       co.linkedin_connected AS co_linkedin_connected,
       co.title AS co_title, co.seniority AS co_seniority,
       co.department AS co_department,
       co.enrichment_data AS co_enrichment_data,
       co.source_api AS co_source_api,
       co.created_at AS co_created_at, co.updated_at AS co_updated_at,
       comp.id AS comp_id, comp.name AS comp_name, comp.domain AS comp_domain,
       comp.website AS comp_website, comp.industry AS comp_industry,
       comp.employee_count AS comp_employee_count,
       comp.employee_count_range AS comp_employee_count_range,
       comp.revenue_range AS comp_revenue_range,
       comp.founded_year AS comp_founded_year,
       comp.location AS comp_location, comp.city AS comp_city,
       comp.state AS comp_state, comp.country AS comp_country,
       comp.tech_stack AS comp_tech_stack,
       comp.signals_found AS comp_signals_found,
       comp.fit_score AS comp_fit_score, comp.fit_notes AS comp_fit_notes,
       comp.disqualified AS comp_disqualified,
       comp.disqualification_reason AS comp_disqualification_reason,
       comp.enrichment_data AS comp_enrichment_data,
       comp.source_api AS comp_source_api,
       comp.source_campaign_id AS comp_source_campaign_id,
       comp.created_at AS comp_created_at, comp.updated_at AS comp_updated_at
     FROM campaign_contacts cc
     JOIN contacts co ON cc.contact_id = co.id
     LEFT JOIN companies comp ON co.company_id = comp.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY cc.added_at`,
    values,
  );

  return rows.map((row) => ({
    id: row.id as string,
    campaign_id: row.campaign_id as string,
    contact_id: row.contact_id as string,
    sequence_step: row.sequence_step as number,
    status: row.status as CampaignContactWithDetails['status'],
    deal_value: row.deal_value as number | null,
    meeting_booked_at: row.meeting_booked_at as string | null,
    proposal_sent_at: row.proposal_sent_at as string | null,
    closed_at: row.closed_at as string | null,
    added_at: row.added_at as string,
    last_contacted_at: row.last_contacted_at as string | null,
    contacts: {
      id: row.co_id as string,
      company_id: row.co_company_id as string,
      first_name: row.co_first_name as string | null,
      last_name: row.co_last_name as string | null,
      full_name: row.co_full_name as string | null,
      email: row.co_email as string | null,
      email_verified: row.co_email_verified as boolean,
      email_verification_date: row.co_email_verification_date as string | null,
      email_verification_source: row.co_email_verification_source as string | null,
      phone: row.co_phone as string | null,
      phone_type: row.co_phone_type as string | null,
      linkedin_url: row.co_linkedin_url as string | null,
      linkedin_connected: row.co_linkedin_connected as boolean,
      title: row.co_title as string | null,
      seniority: row.co_seniority as string | null,
      department: row.co_department as string | null,
      enrichment_data: row.co_enrichment_data as Record<string, unknown> | null,
      source_api: row.co_source_api as string | null,
      created_at: row.co_created_at as string,
      updated_at: row.co_updated_at as string,
      companies: row.comp_id
        ? {
            id: row.comp_id as string,
            name: row.comp_name as string,
            domain: row.comp_domain as string | null,
            website: row.comp_website as string | null,
            industry: row.comp_industry as string | null,
            employee_count: row.comp_employee_count as number | null,
            employee_count_range: row.comp_employee_count_range as string | null,
            revenue_range: row.comp_revenue_range as string | null,
            founded_year: row.comp_founded_year as number | null,
            location: row.comp_location as string | null,
            city: row.comp_city as string | null,
            state: row.comp_state as string | null,
            country: row.comp_country as string | null,
            tech_stack: row.comp_tech_stack as string[] | null,
            signals_found: row.comp_signals_found as Record<string, unknown> | null,
            fit_score: row.comp_fit_score as number | null,
            fit_notes: row.comp_fit_notes as string | null,
            disqualified: row.comp_disqualified as boolean,
            disqualification_reason: row.comp_disqualification_reason as string | null,
            enrichment_data: row.comp_enrichment_data as Record<string, unknown> | null,
            source_api: row.comp_source_api as string | null,
            source_campaign_id: row.comp_source_campaign_id as string | null,
            created_at: row.comp_created_at as string,
            updated_at: row.comp_updated_at as string,
          }
        : undefined,
    },
  })) as CampaignContactWithDetails[];
}

export async function updateCampaignContact(
  ccId: string,
  updates: {
    status?: string;
    sequence_step?: number;
    last_contacted_at?: string;
    deal_value?: number;
    meeting_booked_at?: string;
    proposal_sent_at?: string;
    closed_at?: string;
  },
): Promise<CampaignContact | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex}`);
    values.push(updates.status);
    paramIndex++;
  }

  if (updates.sequence_step !== undefined) {
    setClauses.push(`sequence_step = $${paramIndex}`);
    values.push(updates.sequence_step);
    paramIndex++;
  }

  if (updates.last_contacted_at !== undefined) {
    setClauses.push(`last_contacted_at = $${paramIndex}`);
    values.push(updates.last_contacted_at);
    paramIndex++;
  }

  if (updates.deal_value !== undefined) {
    setClauses.push(`deal_value = $${paramIndex}`);
    values.push(updates.deal_value);
    paramIndex++;
  }

  if (updates.meeting_booked_at !== undefined) {
    setClauses.push(`meeting_booked_at = $${paramIndex}`);
    values.push(updates.meeting_booked_at);
    paramIndex++;
  }

  if (updates.proposal_sent_at !== undefined) {
    setClauses.push(`proposal_sent_at = $${paramIndex}`);
    values.push(updates.proposal_sent_at);
    paramIndex++;
  }

  if (updates.closed_at !== undefined) {
    setClauses.push(`closed_at = $${paramIndex}`);
    values.push(updates.closed_at);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    return queryOne<CampaignContact>(
      "SELECT * FROM campaign_contacts WHERE id = $1",
      [ccId],
    );
  }

  values.push(ccId);

  return queryOne<CampaignContact>(
    `UPDATE campaign_contacts SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
}

async function getMessageLifecycleAggregate(
  campaignContactId: string,
): Promise<MessageLifecycleAggregate> {
  const row = await queryOne<MessageLifecycleAggregate>(
    `SELECT
       COUNT(*)::int AS total_messages,
       COUNT(*) FILTER (WHERE status = 'replied')::int AS replied_count,
       COUNT(*) FILTER (WHERE status = 'bounced')::int AS bounced_count,
       COUNT(*) FILTER (
         WHERE status IN ('draft', 'queued', 'sending', 'sent', 'delivered', 'opened')
       )::int AS in_flight_count
     FROM messages
     WHERE campaign_contact_id = $1`,
    [campaignContactId],
  );

  return row ?? {
    total_messages: 0,
    replied_count: 0,
    bounced_count: 0,
    in_flight_count: 0,
  };
}

function deriveStatusFromMessageAggregate(
  aggregate: MessageLifecycleAggregate,
): CampaignContactStatus {
  if (aggregate.replied_count > 0) return "replied";
  if (aggregate.bounced_count > 0) return "bounced";
  if (aggregate.in_flight_count > 0) return "active";
  if (aggregate.total_messages > 0) return "completed";
  return "pending";
}

function shouldUpdateLastContactedAt(
  messageStatus: MessageStatus,
  occurredAt?: string,
): boolean {
  if (!occurredAt) return false;
  return (
    messageStatus === "sent" ||
    messageStatus === "delivered" ||
    messageStatus === "opened" ||
    messageStatus === "replied"
  );
}

export async function reconcileCampaignContactFromMessageEvent(
  campaignContactId: string,
  messageStatus: MessageStatus,
  occurredAt?: string,
): Promise<CampaignContact | null> {
  const current = await queryOne<CampaignContact>(
    "SELECT * FROM campaign_contacts WHERE id = $1",
    [campaignContactId],
  );
  if (!current) return null;

  if (LOCKED_TERMINAL_STATUSES.has(current.status)) {
    if (shouldUpdateLastContactedAt(messageStatus, occurredAt)) {
      return updateCampaignContact(campaignContactId, {
        last_contacted_at: occurredAt,
      });
    }
    return current;
  }

  const aggregate = await getMessageLifecycleAggregate(campaignContactId);
  const derivedStatus = deriveStatusFromMessageAggregate(aggregate);
  const nextStatus =
    derivedStatus === "pending" && current.status !== "pending"
      ? current.status
      : derivedStatus;

  const updates: {
    status?: CampaignContactStatus;
    last_contacted_at?: string;
  } = {};

  if (nextStatus !== current.status) {
    updates.status = nextStatus;
  }

  if (shouldUpdateLastContactedAt(messageStatus, occurredAt)) {
    updates.last_contacted_at = occurredAt;
  }

  if (!updates.status && !updates.last_contacted_at) {
    return current;
  }

  return updateCampaignContact(campaignContactId, updates);
}
