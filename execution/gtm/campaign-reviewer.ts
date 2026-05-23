import { getCampaignById } from "../db/campaigns.js";
import { getSalesPipelineKPIs } from "../kpi/sales.js";
import { getMarketingKPIs } from "../kpi/marketing.js";

export interface CampaignReview {
  campaign: {
    id: string;
    name: string;
    slug: string;
    signal_type: string | null;
    status: string;
  };
  contacts: {
    total: number;
    replied: number;
    meetings_booked: number;
    reply_rate: number;
  };
  messages: {
    total: number;
    sent: number;
    opened: number;
    replied: number;
    open_rate: number;
    reply_rate: number;
    by_channel: Record<string, number>;
    by_variant: Record<string, { sent: number; replied: number }>;
  };
  costs: {
    total_usd: number;
    cost_per_lead: number;
    by_api: { api_name: string; calls: number; cost: number }[];
  };
}

export async function reviewCampaign(
  campaignId: string,
): Promise<CampaignReview> {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const [salesResult, marketingResult] = await Promise.all([
    getSalesPipelineKPIs({ period: "all_time", campaignId }),
    getMarketingKPIs({ period: "all_time", campaignId }),
  ]);

  const sales = salesResult.current;
  const marketing = marketingResult.current;

  // Map by_channel to simple count (total messages per channel, not just sent)
  const byChannel: Record<string, number> = {};
  for (const [channel, metrics] of Object.entries(marketing.by_channel)) {
    byChannel[channel] = metrics.sent;
  }

  // Map by_variant to { sent, replied } (narrower than VariantMetrics)
  const byVariant: Record<string, { sent: number; replied: number }> = {};
  for (const [variant, metrics] of Object.entries(marketing.by_variant)) {
    byVariant[variant] = { sent: metrics.sent, replied: metrics.replied };
  }

  const totalContacts =
    sales.funnel.pending + sales.funnel.active + sales.funnel.replied +
    sales.funnel.meeting_booked + sales.funnel.proposal_sent +
    sales.funnel.negotiating + sales.funnel.closed_won + sales.funnel.closed_lost;

  // Cumulative: anyone who replied or progressed beyond
  const repliedContacts =
    sales.funnel.replied + sales.funnel.meeting_booked +
    sales.funnel.proposal_sent + sales.funnel.negotiating +
    sales.funnel.closed_won + sales.funnel.closed_lost;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      signal_type: campaign.signal_type,
      status: campaign.status,
    },
    contacts: {
      total: totalContacts,
      replied: repliedContacts,
      meetings_booked: sales.funnel.meeting_booked,
      reply_rate: totalContacts > 0 ? repliedContacts / totalContacts : 0,
    },
    messages: {
      total: marketing.volume.messages_sent + marketing.volume.messages_opened +
        marketing.volume.messages_replied,
      sent: marketing.volume.messages_sent,
      opened: marketing.volume.messages_opened,
      replied: marketing.volume.messages_replied,
      open_rate: marketing.rates.open_rate,
      reply_rate: marketing.rates.reply_rate,
      by_channel: byChannel,
      by_variant: byVariant,
    },
    costs: {
      total_usd: marketing.cost.total_usd,
      cost_per_lead: marketing.cost.cost_per_reply,
      by_api: marketing.cost.by_api.map((a) => ({
        api_name: a.api_name,
        calls: a.calls,
        cost: a.cost_usd,
      })),
    },
  };
}
