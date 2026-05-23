import { queryOne } from "../db/client.js";
import { resolvePeriod, wrapKPIResult } from "./periods.js";
import type { SalesKPIOptions, SalesPipelineMetrics, KPIResult } from "./types.js";

interface SalesRow {
  pending: number;
  active: number;
  replied: number;
  meeting_booked: number;
  proposal_sent: number;
  negotiating: number;
  closed_won: number;
  closed_lost: number;
  total_open_value: number;
  total_closed_won_value: number;
  deals_with_value: number;
  total_deal_value_sum: number;
  avg_days_to_reply: number | null;
  avg_days_to_meeting: number | null;
  avg_days_to_close: number | null;
}

function buildQuery(
  from: Date,
  to: Date,
  options: SalesKPIOptions,
): { text: string; params: unknown[] } {
  const conditions: string[] = ["cc.added_at >= $1", "cc.added_at < $2"];
  const params: unknown[] = [from.toISOString(), to.toISOString()];
  let paramIndex = 3;

  if (options.campaignId) {
    conditions.push(`cc.campaign_id = $${paramIndex}`);
    params.push(options.campaignId);
    paramIndex++;
  }

  if (options.offerId) {
    conditions.push(`c.offer_id = $${paramIndex}`);
    params.push(options.offerId);
    paramIndex++;
  }

  const joinCampaigns = options.offerId ? "JOIN campaigns c ON cc.campaign_id = c.id" : "";
  const where = conditions.join(" AND ");

  const text = `
    SELECT
      COUNT(*) FILTER (WHERE cc.status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE cc.status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE cc.status = 'replied')::int AS replied,
      COUNT(*) FILTER (WHERE cc.status = 'meeting_booked')::int AS meeting_booked,
      COUNT(*) FILTER (WHERE cc.status = 'proposal_sent')::int AS proposal_sent,
      COUNT(*) FILTER (WHERE cc.status = 'negotiating')::int AS negotiating,
      COUNT(*) FILTER (WHERE cc.status = 'closed_won')::int AS closed_won,
      COUNT(*) FILTER (WHERE cc.status = 'closed_lost')::int AS closed_lost,
      COALESCE(SUM(cc.deal_value) FILTER (
        WHERE cc.status IN ('meeting_booked', 'proposal_sent', 'negotiating')
      ), 0)::numeric AS total_open_value,
      COALESCE(SUM(cc.deal_value) FILTER (WHERE cc.status = 'closed_won'), 0)::numeric AS total_closed_won_value,
      COUNT(*) FILTER (WHERE cc.deal_value IS NOT NULL AND cc.status = 'closed_won')::int AS deals_with_value,
      COALESCE(SUM(cc.deal_value) FILTER (WHERE cc.deal_value IS NOT NULL AND cc.status = 'closed_won'), 0)::numeric AS total_deal_value_sum,
      AVG(EXTRACT(EPOCH FROM (m_reply.earliest_reply - cc.added_at)) / 86400)
        FILTER (WHERE m_reply.earliest_reply IS NOT NULL) AS avg_days_to_reply,
      AVG(EXTRACT(EPOCH FROM (cc.meeting_booked_at - cc.added_at)) / 86400)
        FILTER (WHERE cc.meeting_booked_at IS NOT NULL) AS avg_days_to_meeting,
      AVG(EXTRACT(EPOCH FROM (cc.closed_at - cc.added_at)) / 86400)
        FILTER (WHERE cc.closed_at IS NOT NULL) AS avg_days_to_close
    FROM campaign_contacts cc
    ${joinCampaigns}
    LEFT JOIN LATERAL (
      SELECT MIN(replied_at) AS earliest_reply
      FROM messages
      WHERE campaign_contact_id = cc.id AND replied_at IS NOT NULL
    ) m_reply ON true
    WHERE ${where}
  `;

  return { text, params };
}

function rowToMetrics(row: SalesRow): SalesPipelineMetrics {
  const funnel = {
    pending: row.pending,
    active: row.active,
    replied: row.replied,
    meeting_booked: row.meeting_booked,
    proposal_sent: row.proposal_sent,
    negotiating: row.negotiating,
    closed_won: row.closed_won,
    closed_lost: row.closed_lost,
  };

  const safeRate = (num: number, denom: number) => (denom > 0 ? num / denom : 0);

  // Cumulative: contacts who reached a stage or passed through it
  const reachedReply = funnel.replied + funnel.meeting_booked + funnel.proposal_sent +
    funnel.negotiating + funnel.closed_won + funnel.closed_lost;
  const reachedMeeting = funnel.meeting_booked + funnel.proposal_sent +
    funnel.negotiating + funnel.closed_won + funnel.closed_lost;
  const reachedProposal = funnel.proposal_sent + funnel.negotiating +
    funnel.closed_won + funnel.closed_lost;
  const reachedNegotiating = funnel.negotiating + funnel.closed_won + funnel.closed_lost;
  const totalActive = funnel.active + reachedReply;
  const closedTotal = funnel.closed_won + funnel.closed_lost;

  return {
    funnel,
    conversion_rates: {
      active_to_replied: safeRate(reachedReply, totalActive),
      replied_to_meeting: safeRate(reachedMeeting, reachedReply),
      meeting_to_proposal: safeRate(reachedProposal, reachedMeeting),
      proposal_to_negotiating: safeRate(reachedNegotiating, reachedProposal),
      negotiating_to_closed_won: safeRate(funnel.closed_won, reachedNegotiating),
      overall_win_rate: safeRate(funnel.closed_won, closedTotal),
    },
    velocity: {
      avg_days_to_reply: row.avg_days_to_reply !== null ? Number(row.avg_days_to_reply) : null,
      avg_days_to_meeting: row.avg_days_to_meeting !== null ? Number(row.avg_days_to_meeting) : null,
      avg_days_to_close: row.avg_days_to_close !== null ? Number(row.avg_days_to_close) : null,
    },
    pipeline_value: {
      total_open: Number(row.total_open_value),
      total_closed_won: Number(row.total_closed_won_value),
      avg_deal_size: row.deals_with_value > 0
        ? Number(row.total_deal_value_sum) / row.deals_with_value
        : null,
    },
  };
}

const EMPTY_ROW: SalesRow = {
  pending: 0, active: 0, replied: 0, meeting_booked: 0,
  proposal_sent: 0, negotiating: 0, closed_won: 0, closed_lost: 0,
  total_open_value: 0, total_closed_won_value: 0,
  deals_with_value: 0, total_deal_value_sum: 0,
  avg_days_to_reply: null, avg_days_to_meeting: null, avg_days_to_close: null,
};

export async function getSalesPipelineKPIs(
  options: SalesKPIOptions,
): Promise<KPIResult<SalesPipelineMetrics>> {
  const resolved = resolvePeriod(options.period);

  const currentQuery = buildQuery(resolved.current.from, resolved.current.to, options);
  const currentRow = await queryOne<SalesRow>(currentQuery.text, currentQuery.params);
  const current = rowToMetrics(currentRow ?? EMPTY_ROW);

  let previous: SalesPipelineMetrics | null = null;
  if (resolved.previous) {
    const prevQuery = buildQuery(resolved.previous.from, resolved.previous.to, options);
    const prevRow = await queryOne<SalesRow>(prevQuery.text, prevQuery.params);
    previous = rowToMetrics(prevRow ?? EMPTY_ROW);
  }

  return wrapKPIResult(resolved, current, previous);
}
