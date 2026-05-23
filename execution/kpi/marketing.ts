import { queryMany, queryOne } from "../db/client.js";
import { resolvePeriod, wrapKPIResult } from "./periods.js";
import type {
  MarketingKPIOptions,
  MarketingMetrics,
  ChannelMetrics,
  VariantMetrics,
  SignalTypeMetrics,
  SequenceStepMetrics,
  KPIResult,
} from "./types.js";

const SENT_STATUSES = "('sent', 'delivered', 'opened', 'replied')";
const OPENED_STATUSES = "('opened', 'replied')";

interface VolumeRow {
  contacts_reached: number;
  messages_sent: number;
  messages_opened: number;
  messages_replied: number;
  positive_replies: number;
  total_replies: number;
}

interface ChannelRow {
  channel: string;
  sent: number;
  opened: number;
  replied: number;
}

interface VariantRow {
  copy_variant: string;
  sent: number;
  opened: number;
  replied: number;
}

interface SignalRow {
  signal_type: string;
  contacts: number;
  replied: number;
  meetings: number;
}

interface SequenceRow {
  sequence_step: number;
  sent: number;
  opened: number;
  replied: number;
}

interface CostApiRow {
  api_name: string;
  calls: number;
  cost_usd: number;
}

function buildConditions(
  from: Date,
  to: Date,
  options: MarketingKPIOptions,
): { messageWhere: string; params: unknown[]; paramIndex: number } {
  const conditions: string[] = [
    "m.created_at >= $1",
    "m.created_at < $2",
  ];
  const params: unknown[] = [from.toISOString(), to.toISOString()];
  let paramIndex = 3;

  if (options.campaignId) {
    conditions.push(`cc.campaign_id = $${paramIndex}`);
    params.push(options.campaignId);
    paramIndex++;
  }

  if (options.offerId) {
    conditions.push(`camp.offer_id = $${paramIndex}`);
    params.push(options.offerId);
    paramIndex++;
  }

  if (options.channel) {
    conditions.push(`m.channel = $${paramIndex}`);
    params.push(options.channel);
    paramIndex++;
  }

  return { messageWhere: conditions.join(" AND "), params, paramIndex };
}

function needsCampaignJoin(options: MarketingKPIOptions): boolean {
  return !!(options.offerId);
}

function campaignJoin(options: MarketingKPIOptions): string {
  return needsCampaignJoin(options)
    ? "JOIN campaigns camp ON cc.campaign_id = camp.id"
    : "";
}

async function queryVolume(
  from: Date,
  to: Date,
  options: MarketingKPIOptions,
): Promise<VolumeRow> {
  const { messageWhere, params } = buildConditions(from, to, options);
  const join = campaignJoin(options);

  const row = await queryOne<VolumeRow>(
    `SELECT
      COUNT(DISTINCT cc.contact_id)::int AS contacts_reached,
      COUNT(*) FILTER (WHERE m.status IN ${SENT_STATUSES})::int AS messages_sent,
      COUNT(*) FILTER (WHERE m.status IN ${OPENED_STATUSES})::int AS messages_opened,
      COUNT(*) FILTER (WHERE m.status = 'replied')::int AS messages_replied,
      COUNT(*) FILTER (WHERE m.status = 'replied' AND m.reply_sentiment = 'positive')::int AS positive_replies,
      COUNT(*) FILTER (WHERE m.status = 'replied')::int AS total_replies
    FROM messages m
    JOIN campaign_contacts cc ON m.campaign_contact_id = cc.id
    ${join}
    WHERE ${messageWhere}`,
    params,
  );

  return row ?? {
    contacts_reached: 0, messages_sent: 0, messages_opened: 0,
    messages_replied: 0, positive_replies: 0, total_replies: 0,
  };
}

async function queryByChannel(
  from: Date,
  to: Date,
  options: MarketingKPIOptions,
): Promise<Record<string, ChannelMetrics>> {
  const { messageWhere, params } = buildConditions(from, to, options);
  const join = campaignJoin(options);

  const rows = await queryMany<ChannelRow>(
    `SELECT
      m.channel,
      COUNT(*) FILTER (WHERE m.status IN ${SENT_STATUSES})::int AS sent,
      COUNT(*) FILTER (WHERE m.status IN ${OPENED_STATUSES})::int AS opened,
      COUNT(*) FILTER (WHERE m.status = 'replied')::int AS replied
    FROM messages m
    JOIN campaign_contacts cc ON m.campaign_contact_id = cc.id
    ${join}
    WHERE ${messageWhere}
    GROUP BY m.channel`,
    params,
  );

  const result: Record<string, ChannelMetrics> = {};
  for (const row of rows) {
    result[row.channel] = {
      sent: row.sent,
      opened: row.opened,
      replied: row.replied,
      open_rate: row.sent > 0 ? row.opened / row.sent : 0,
      reply_rate: row.sent > 0 ? row.replied / row.sent : 0,
    };
  }
  return result;
}

async function queryByVariant(
  from: Date,
  to: Date,
  options: MarketingKPIOptions,
): Promise<Record<string, VariantMetrics>> {
  const { messageWhere, params } = buildConditions(from, to, options);
  const join = campaignJoin(options);

  const rows = await queryMany<VariantRow>(
    `SELECT
      COALESCE(m.copy_variant, 'default') AS copy_variant,
      COUNT(*) FILTER (WHERE m.status IN ${SENT_STATUSES})::int AS sent,
      COUNT(*) FILTER (WHERE m.status IN ${OPENED_STATUSES})::int AS opened,
      COUNT(*) FILTER (WHERE m.status = 'replied')::int AS replied
    FROM messages m
    JOIN campaign_contacts cc ON m.campaign_contact_id = cc.id
    ${join}
    WHERE ${messageWhere}
    GROUP BY COALESCE(m.copy_variant, 'default')`,
    params,
  );

  const result: Record<string, VariantMetrics> = {};
  for (const row of rows) {
    result[row.copy_variant] = {
      sent: row.sent,
      opened: row.opened,
      replied: row.replied,
      open_rate: row.sent > 0 ? row.opened / row.sent : 0,
      reply_rate: row.sent > 0 ? row.replied / row.sent : 0,
      sample_size_sufficient: row.sent >= 30,
    };
  }
  return result;
}

async function queryBySignalType(
  from: Date,
  to: Date,
  options: MarketingKPIOptions,
): Promise<Record<string, SignalTypeMetrics>> {
  const conditions: string[] = ["cc.added_at >= $1", "cc.added_at < $2"];
  const params: unknown[] = [from.toISOString(), to.toISOString()];
  let paramIndex = 3;

  if (options.campaignId) {
    conditions.push(`camp.id = $${paramIndex}`);
    params.push(options.campaignId);
    paramIndex++;
  }

  if (options.offerId) {
    conditions.push(`camp.offer_id = $${paramIndex}`);
    params.push(options.offerId);
    paramIndex++;
  }

  const where = conditions.join(" AND ");

  const rows = await queryMany<SignalRow>(
    `SELECT
      camp.signal_type,
      COUNT(DISTINCT cc.id)::int AS contacts,
      COUNT(DISTINCT cc.id) FILTER (WHERE cc.status = 'replied')::int AS replied,
      COUNT(DISTINCT cc.id) FILTER (WHERE cc.status = 'meeting_booked')::int AS meetings
    FROM campaign_contacts cc
    JOIN campaigns camp ON cc.campaign_id = camp.id
    WHERE camp.signal_type IS NOT NULL AND ${where}
    GROUP BY camp.signal_type`,
    params,
  );

  const result: Record<string, SignalTypeMetrics> = {};
  for (const row of rows) {
    result[row.signal_type] = {
      contacts: row.contacts,
      replied: row.replied,
      meetings: row.meetings,
      reply_rate: row.contacts > 0 ? row.replied / row.contacts : 0,
    };
  }
  return result;
}

async function queryBySequenceStep(
  from: Date,
  to: Date,
  options: MarketingKPIOptions,
): Promise<Record<number, SequenceStepMetrics>> {
  const { messageWhere, params } = buildConditions(from, to, options);
  const join = campaignJoin(options);

  const rows = await queryMany<SequenceRow>(
    `SELECT
      m.sequence_step,
      COUNT(*) FILTER (WHERE m.status IN ${SENT_STATUSES})::int AS sent,
      COUNT(*) FILTER (WHERE m.status IN ${OPENED_STATUSES})::int AS opened,
      COUNT(*) FILTER (WHERE m.status = 'replied')::int AS replied
    FROM messages m
    JOIN campaign_contacts cc ON m.campaign_contact_id = cc.id
    ${join}
    WHERE ${messageWhere}
    GROUP BY m.sequence_step
    ORDER BY m.sequence_step`,
    params,
  );

  const result: Record<number, SequenceStepMetrics> = {};
  for (const row of rows) {
    result[row.sequence_step] = {
      sent: row.sent,
      opened: row.opened,
      replied: row.replied,
      reply_rate: row.sent > 0 ? row.replied / row.sent : 0,
    };
  }
  return result;
}

async function queryCosts(
  from: Date,
  to: Date,
  options: MarketingKPIOptions,
): Promise<{ total_usd: number; by_api: CostApiRow[] }> {
  const conditions: string[] = [
    "tu.recorded_at >= $1",
    "tu.recorded_at < $2",
    "tu.campaign_id IS NOT NULL",
  ];
  const params: unknown[] = [from.toISOString(), to.toISOString()];
  let paramIndex = 3;

  if (options.campaignId) {
    conditions.push(`tu.campaign_id = $${paramIndex}`);
    params.push(options.campaignId);
    paramIndex++;
  }

  if (options.offerId) {
    conditions.push(`camp.offer_id = $${paramIndex}`);
    params.push(options.offerId);
    paramIndex++;
  }

  const join = options.offerId
    ? "JOIN campaigns camp ON tu.campaign_id = camp.id"
    : "";
  const where = conditions.join(" AND ");

  const rows = await queryMany<CostApiRow>(
    `SELECT
      tu.api_name,
      COUNT(*)::int AS calls,
      COALESCE(SUM(tu.cost_usd), 0)::numeric AS cost_usd
    FROM tool_usage tu
    ${join}
    WHERE ${where}
    GROUP BY tu.api_name`,
    params,
  );

  let total_usd = 0;
  for (const row of rows) {
    row.cost_usd = Number(row.cost_usd);
    total_usd += row.cost_usd;
  }

  return { total_usd, by_api: rows };
}

async function fetchMetrics(
  from: Date,
  to: Date,
  options: MarketingKPIOptions,
): Promise<MarketingMetrics> {
  const [volume, byChannel, byVariant, bySignalType, bySequenceStep, costs] =
    await Promise.all([
      queryVolume(from, to, options),
      queryByChannel(from, to, options),
      queryByVariant(from, to, options),
      queryBySignalType(from, to, options),
      queryBySequenceStep(from, to, options),
      queryCosts(from, to, options),
    ]);

  const safeRate = (num: number, denom: number) => (denom > 0 ? num / denom : 0);

  // Count meetings from signal type breakdown (most accurate)
  let totalMeetings = 0;
  for (const st of Object.values(bySignalType)) {
    totalMeetings += st.meetings;
  }

  return {
    volume: {
      contacts_reached: volume.contacts_reached,
      messages_sent: volume.messages_sent,
      messages_opened: volume.messages_opened,
      messages_replied: volume.messages_replied,
    },
    rates: {
      open_rate: safeRate(volume.messages_opened, volume.messages_sent),
      reply_rate: safeRate(volume.messages_replied, volume.messages_sent),
      positive_sentiment_rate: safeRate(volume.positive_replies, volume.total_replies),
    },
    by_channel: byChannel,
    by_variant: byVariant,
    by_signal_type: bySignalType,
    cost: {
      total_usd: costs.total_usd,
      cost_per_reply: safeRate(costs.total_usd, volume.messages_replied),
      cost_per_meeting: safeRate(costs.total_usd, totalMeetings),
      by_api: costs.by_api,
    },
    by_sequence_step: bySequenceStep,
  };
}

export async function getMarketingKPIs(
  options: MarketingKPIOptions,
): Promise<KPIResult<MarketingMetrics>> {
  const resolved = resolvePeriod(options.period);

  const current = await fetchMetrics(
    resolved.current.from,
    resolved.current.to,
    options,
  );

  let previous: MarketingMetrics | null = null;
  if (resolved.previous) {
    previous = await fetchMetrics(
      resolved.previous.from,
      resolved.previous.to,
      options,
    );
  }

  return wrapKPIResult(resolved, current, previous);
}
