import type { SignalType, SignalConfig } from "../types/campaign.js";
import type { ICP } from "../types/offer.js";
import type { UpsertCompanyInput, SignalData } from "../types/company.js";
import { getCampaignById, updateCampaign } from "../db/campaigns.js";
import { upsertCompany, companyExists } from "../db/companies.js";
import { scoreCompany, checkDisqualifiers } from "./company-scorer.js";
import { routeSignal } from "./signal-router.js";

export interface FindCompaniesResult {
  qualified: (UpsertCompanyInput & { id?: string; fit_score?: number })[];
  stats: {
    total_found: number;
    qualified: number;
    skipped_existing: number;
    skipped_score: number;
    skipped_disqualified: number;
  };
}

export async function findCompanies(
  campaignId: string,
  minFitScore = 30,
): Promise<FindCompaniesResult> {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const signalType = (campaign.signal_type ?? "firmographic") as SignalType;
  const signalConfig = (campaign.signal_config ?? {}) as SignalConfig;
  if (Object.keys(signalConfig).length === 0) {
    throw new Error(`Campaign has no signal_config: ${campaignId}`);
  }

  const offer = campaign.offers;
  if (!offer) throw new Error(`Campaign has no linked offer: ${campaignId}`);

  const icp = (offer.icp ?? {}) as ICP;

  // Route to correct API
  const rawCompanies = await routeSignal(signalType, signalConfig, campaignId);

  if (rawCompanies.length === 0) {
    return { qualified: [], stats: { total_found: 0, qualified: 0, skipped_existing: 0, skipped_score: 0, skipped_disqualified: 0 } };
  }

  const qualified: (UpsertCompanyInput & { id?: string; fit_score?: number })[] = [];
  let skippedExisting = 0;
  let skippedScore = 0;
  let skippedDq = 0;

  for (const company of rawCompanies) {
    const domain = company.domain;
    if (!domain) continue;

    // Deduplicate
    if (await companyExists(domain)) {
      skippedExisting++;
      continue;
    }

    // Disqualifiers
    const dqReason = checkDisqualifiers(company, icp);
    if (dqReason) {
      skippedDq++;
      continue;
    }

    // Score
    const { score: fitScore, notes } = scoreCompany(company as UpsertCompanyInput & { signals_found?: SignalData }, icp);
    if (fitScore < minFitScore) {
      skippedScore++;
      continue;
    }

    // Save
    try {
      const saved = await upsertCompany({
        name: company.name,
        domain,
        website: company.website ?? `https://${domain}`,
        industry: company.industry,
        employee_count: company.employee_count,
        employee_count_range: company.employee_count_range,
        revenue_range: company.revenue_range,
        founded_year: company.founded_year,
        location: company.location,
        city: company.city,
        state: company.state,
        country: company.country,
        tech_stack: company.tech_stack,
        source_api: company.source_api ?? signalType,
        source_campaign_id: campaignId,
        fit_score: fitScore,
        fit_notes: notes.join("; "),
        signals_found: company.signals_found,
        enrichment_data: company.enrichment_data,
      });
      qualified.push({ ...company, id: saved.id, fit_score: fitScore });
    } catch (err) {
      console.error(`Failed to save company ${domain}:`, err);
    }
  }

  // Update campaign status
  try {
    await updateCampaign(campaignId, { status: "active" });
  } catch {
    // non-critical
  }

  return {
    qualified,
    stats: {
      total_found: rawCompanies.length,
      qualified: qualified.length,
      skipped_existing: skippedExisting,
      skipped_score: skippedScore,
      skipped_disqualified: skippedDq,
    },
  };
}
