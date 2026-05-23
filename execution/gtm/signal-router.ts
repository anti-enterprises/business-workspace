import type { SignalType, SignalConfig } from "../types/campaign.js";
import type { UpsertCompanyInput, SignalData } from "../types/company.js";
import { logSignalRoutingAudit } from "../db/signal-routing-audit.js";
import * as parallel from "../apis/parallel.js";
import * as theirstack from "../apis/theirstack.js";
import * as exa from "../apis/exa.js";

type CompanyWithSignal = UpsertCompanyInput & { signals_found?: SignalData };

const PUBLISHER_DOMAINS = new Set([
  "techcrunch.com",
  "www.techcrunch.com",
  "crunchbase.com",
  "www.crunchbase.com",
  "forbes.com",
  "www.forbes.com",
  "businesswire.com",
  "www.businesswire.com",
  "prnewswire.com",
  "www.prnewswire.com",
  "globenewswire.com",
  "www.globenewswire.com",
  "venturebeat.com",
  "www.venturebeat.com",
  "axios.com",
  "www.axios.com",
  "bloomberg.com",
  "www.bloomberg.com",
  "reuters.com",
  "www.reuters.com",
  "fortune.com",
  "www.fortune.com",
  "inc.com",
  "www.inc.com",
  "wsj.com",
  "www.wsj.com",
  "nytimes.com",
  "www.nytimes.com",
  "fastcompany.com",
  "www.fastcompany.com",
  "ycombinator.com",
  "www.ycombinator.com",
  "linkedin.com",
  "www.linkedin.com",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "reddit.com",
  "www.reddit.com",
  "youtube.com",
  "www.youtube.com",
  "substack.com",
  "www.substack.com",
  "medium.com",
  "www.medium.com",
]);

const PUBLISHER_SUFFIXES = [
  ".medium.com",
  ".substack.com",
  ".wordpress.com",
  ".blogspot.com",
];

function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let domain = trimmed;
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    try {
      domain = new URL(domain).hostname.toLowerCase();
    } catch {
      return null;
    }
  } else {
    domain = domain.split("/")[0];
  }

  if (domain.startsWith("www.")) {
    domain = domain.slice(4);
  }

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return domain;
}

function isPublisherDomain(domain: string): boolean {
  if (PUBLISHER_DOMAINS.has(domain)) return true;
  return PUBLISHER_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

function extractCompanyDomainCandidate(raw: Record<string, unknown>): string | null {
  const directCandidates = [
    raw.company_domain,
    raw.companyDomain,
    raw.domain,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeDomain(candidate);
    if (normalized) return normalized;
  }

  const rawCompany =
    typeof raw.company === "object" && raw.company !== null
      ? (raw.company as Record<string, unknown>)
      : null;

  if (rawCompany) {
    const nestedCandidates = [
      rawCompany.domain,
      rawCompany.company_domain,
      rawCompany.website,
    ];
    for (const candidate of nestedCandidates) {
      const normalized = normalizeDomain(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}

export function resolveQualifiedExaCompanyDomain(
  raw: Record<string, unknown>,
  normalized: exa.NormalizedSearchResult,
): {
  domain: string | null;
  reason?: string;
  source?: "metadata";
  candidate_domain?: string | null;
} {
  const candidate = extractCompanyDomainCandidate(raw);
  if (!candidate) {
    return {
      domain: null,
      reason: "missing_company_domain_metadata",
      candidate_domain: null,
    };
  }

  if (isPublisherDomain(candidate)) {
    return {
      domain: null,
      reason: "publisher_or_aggregator_domain",
      candidate_domain: candidate,
    };
  }

  if (candidate === normalizeDomain(normalized.domain)) {
    return { domain: candidate, source: "metadata", candidate_domain: candidate };
  }

  // High-precision mode: trust explicit metadata and skip URL-domain inference.
  return { domain: candidate, source: "metadata", candidate_domain: candidate };
}

function buildExaEnrichment(
  raw: Record<string, unknown>,
  normalized: exa.NormalizedSearchResult,
  domainSource: "metadata",
): Record<string, unknown> {
  return {
    exa_raw: raw,
    exa_normalized: normalized,
    domain_source: domainSource,
  };
}

async function recordExaRoutingAudit(input: {
  campaignId: string;
  signalType: "funding" | "news";
  decision: "accepted" | "skipped";
  reason: string;
  normalized: exa.NormalizedSearchResult;
  raw: Record<string, unknown>;
  candidateDomain?: string | null;
  companyDomain?: string | null;
}): Promise<void> {
  try {
    await logSignalRoutingAudit({
      campaign_id: input.campaignId,
      signal_type: input.signalType,
      decision: input.decision,
      reason: input.reason,
      candidate_domain: input.candidateDomain ?? undefined,
      company_domain: input.companyDomain ?? undefined,
      source_api: "exa",
      result_url: input.normalized.url,
      result_title: input.normalized.title,
      payload: {
        exa_raw: input.raw,
        exa_normalized: input.normalized,
      },
    });
  } catch (error) {
    console.warn("[signal-router] Failed to persist signal routing audit", {
      signal_type: input.signalType,
      decision: input.decision,
      reason: input.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function logSkippedExaResult(
  signalType: "funding" | "news",
  reason: string,
  normalized: exa.NormalizedSearchResult,
  raw: Record<string, unknown>,
): void {
  console.warn(
    `[signal-router] Skipping ${signalType} result (${reason})`,
    {
      title: normalized.title,
      url: normalized.url,
      url_domain: normalized.domain,
      raw_result: raw,
    },
  );
}

export async function routeSignal(
  signalType: SignalType,
  config: SignalConfig,
  campaignId: string,
): Promise<CompanyWithSignal[]> {
  switch (signalType) {
    case "hiring":
      return searchHiring(config, campaignId);
    case "tech_stack":
      return searchTechStack(config, campaignId);
    case "funding":
      return searchFunding(config, campaignId);
    case "growth":
      return searchGrowth(config, campaignId);
    case "news":
      return searchNews(config, campaignId);
    case "firmographic":
      return searchFirmographic(config, campaignId);
    case "custom":
      return searchFirmographic(config, campaignId);
  }
}

async function searchHiring(config: SignalConfig, campaignId: string): Promise<CompanyWithSignal[]> {
  let keywords = config.job_titles ?? config.keywords ?? [];
  if (typeof keywords === "string") keywords = [keywords];

  const jobs = await theirstack.searchJobs({
    job_title_contains: keywords as string[],
    company_size_min: config.company_size_min,
    company_size_max: config.company_size_max,
    company_industry: config.industry,
    company_country: config.country,
    posted_after: config.posted_after,
    limit: config.limit ?? 50,
    campaignId,
  });

  const seen = new Set<string>();
  const companies: CompanyWithSignal[] = [];

  for (const job of jobs) {
    const company = theirstack.normalizeCompanyFromJob(job);
    const domain = company.domain;
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);

    const domainJobs = jobs.filter((j) => {
      const jDomain = (j.company_domain as string) ??
        ((j.company as Record<string, unknown>)?.domain as string) ?? "";
      return jDomain === domain;
    });
    const signals = theirstack.extractHiringSignals(domainJobs);

    companies.push({
      ...company,
      signals_found: { ...signals, signal_type: "hiring" },
    });
  }

  return companies;
}

async function searchTechStack(config: SignalConfig, campaignId: string): Promise<CompanyWithSignal[]> {
  let technologies = config.technologies ?? [];
  if (typeof technologies === "string") technologies = [technologies];

  const raw = await parallel.searchCompanies({
    technologies,
    industry: config.industry,
    employee_count_min: config.employee_count_min,
    employee_count_max: config.employee_count_max,
    country: config.country,
    limit: config.limit ?? 50,
    campaignId,
  });

  return raw.map((r) => ({
    ...parallel.normalizeCompany(r),
    signals_found: { technologies_matched: technologies, signal_type: "tech_stack" },
  }));
}

async function searchFunding(config: SignalConfig, campaignId: string): Promise<CompanyWithSignal[]> {
  const results = await exa.findRecentlyFunded({
    vertical: config.vertical ?? "B2B SaaS",
    funding_stage: config.funding_stage,
    days_back: config.days_back ?? 90,
    num_results: config.limit ?? 20,
    campaignId,
  });

  const companies: CompanyWithSignal[] = [];
  for (const r of results) {
    const normalized = exa.normalizeSearchResult(r);
    const resolved = resolveQualifiedExaCompanyDomain(r, normalized);
    if (!resolved.domain || !resolved.source) {
      logSkippedExaResult("funding", resolved.reason ?? "unknown_reason", normalized, r);
      await recordExaRoutingAudit({
        campaignId,
        signalType: "funding",
        decision: "skipped",
        reason: resolved.reason ?? "unknown_reason",
        normalized,
        raw: r,
        candidateDomain: resolved.candidate_domain,
      });
      continue;
    }

    const signals: SignalData = {
      signal_type: "funding",
      published_date: normalized.published_date,
      summary: normalized.summary,
      highlights: normalized.highlights,
    };

    await recordExaRoutingAudit({
      campaignId,
      signalType: "funding",
      decision: "accepted",
      reason: "qualified_company_domain",
      normalized,
      raw: r,
      candidateDomain: resolved.candidate_domain,
      companyDomain: resolved.domain,
    });

    companies.push({
      name: normalized.title,
      domain: resolved.domain,
      website: `https://${resolved.domain}`,
      source_api: "exa",
      signals_found: signals,
      enrichment_data: {
        ...buildExaEnrichment(r, normalized, resolved.source),
        routing_decision: "accepted",
        routing_reason: "qualified_company_domain",
        candidate_domain: resolved.candidate_domain,
      },
    });
  }
  return companies;
}

async function searchGrowth(config: SignalConfig, campaignId: string): Promise<CompanyWithSignal[]> {
  const raw = await parallel.searchCompanies({
    industry: config.industry,
    employee_count_min: config.employee_count_min,
    employee_count_max: config.employee_count_max,
    keywords: typeof config.keywords === "string" ? config.keywords : config.keywords?.[0],
    country: config.country,
    limit: config.limit ?? 50,
    campaignId,
  });

  return raw.map((r) => ({
    ...parallel.normalizeCompany(r),
    signals_found: { signal_type: "growth" },
  }));
}

async function searchNews(config: SignalConfig, campaignId: string): Promise<CompanyWithSignal[]> {
  let query = config.query ?? config.keywords ?? "";
  if (Array.isArray(query)) query = query.join(" OR ");

  const results = await exa.search({
    query: query as string,
    num_results: config.limit ?? 20,
    start_published_date: config.start_date,
    category: config.category ?? "news",
    campaignId,
  });

  const companies: CompanyWithSignal[] = [];
  for (const r of results) {
    const normalized = exa.normalizeSearchResult(r);
    const resolved = resolveQualifiedExaCompanyDomain(r, normalized);
    if (!resolved.domain || !resolved.source) {
      logSkippedExaResult("news", resolved.reason ?? "unknown_reason", normalized, r);
      await recordExaRoutingAudit({
        campaignId,
        signalType: "news",
        decision: "skipped",
        reason: resolved.reason ?? "unknown_reason",
        normalized,
        raw: r,
        candidateDomain: resolved.candidate_domain,
      });
      continue;
    }

    const signals: SignalData = {
      signal_type: "news",
      published_date: normalized.published_date,
      summary: normalized.summary,
    };

    await recordExaRoutingAudit({
      campaignId,
      signalType: "news",
      decision: "accepted",
      reason: "qualified_company_domain",
      normalized,
      raw: r,
      candidateDomain: resolved.candidate_domain,
      companyDomain: resolved.domain,
    });

    companies.push({
      name: normalized.title,
      domain: resolved.domain,
      website: `https://${resolved.domain}`,
      source_api: "exa",
      signals_found: signals,
      enrichment_data: {
        ...buildExaEnrichment(r, normalized, resolved.source),
        routing_decision: "accepted",
        routing_reason: "qualified_company_domain",
        candidate_domain: resolved.candidate_domain,
      },
    });
  }
  return companies;
}

async function searchFirmographic(config: SignalConfig, campaignId: string): Promise<CompanyWithSignal[]> {
  const raw = await parallel.searchCompanies({
    industry: config.industry,
    employee_count_min: config.employee_count_min,
    employee_count_max: config.employee_count_max,
    revenue_min: config.revenue_min,
    revenue_max: config.revenue_max,
    technologies: config.technologies,
    location: config.location,
    country: config.country,
    keywords: typeof config.keywords === "string" ? config.keywords : config.keywords?.[0],
    limit: config.limit ?? 50,
    campaignId,
  });

  return raw.map((r) => ({
    ...parallel.normalizeCompany(r),
    signals_found: { signal_type: "firmographic" },
  }));
}
