import { getEnv } from "../config/env.js";
import { BaseApiClient } from "./base-client.js";
import type { UpsertCompanyInput } from "../types/company.js";
import type { UpsertContactInput, Seniority } from "../types/contact.js";

class ParallelClient extends BaseApiClient {
  protected readonly apiName = "parallel";
  protected readonly baseUrl = "https://api.parallelhq.com/v1";
  protected readonly timeout = 30000;

  protected getHeaders() {
    const key = getEnv().PARALLEL_API_KEY;
    if (!key) throw new Error("PARALLEL_API_KEY not set");
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }
}

const client = new ParallelClient();

export interface SearchCompaniesParams {
  industry?: string;
  employee_count_min?: number;
  employee_count_max?: number;
  revenue_min?: number;
  revenue_max?: number;
  technologies?: string[];
  location?: string;
  country?: string;
  keywords?: string;
  limit?: number;
  campaignId?: string;
}

export async function searchCompanies(params: SearchCompaniesParams): Promise<Record<string, unknown>[]> {
  const body: Record<string, unknown> = { limit: params.limit ?? 50 };

  if (params.industry) body.industry = params.industry;
  if (params.employee_count_min != null) body.employee_count_min = params.employee_count_min;
  if (params.employee_count_max != null) body.employee_count_max = params.employee_count_max;
  if (params.revenue_min != null) body.revenue_min = params.revenue_min;
  if (params.revenue_max != null) body.revenue_max = params.revenue_max;
  if (params.technologies) body.technologies = params.technologies;
  if (params.location) body.location = params.location;
  if (params.country) body.country = params.country;
  if (params.keywords) body.keywords = params.keywords;

  const data = await client.request<{ results?: unknown[]; data?: unknown[] }>(
    "companies/search",
    { body, campaignId: params.campaignId },
  );
  return (data.results ?? data.data ?? []) as Record<string, unknown>[];
}

export async function enrichCompany(domain: string, campaignId?: string): Promise<Record<string, unknown>> {
  return client.request("companies/enrich", {
    method: "GET",
    params: { domain },
    campaignId,
  });
}

export interface SearchPeopleParams {
  company_domain?: string;
  company_name?: string;
  titles?: string[];
  seniority?: string[];
  department?: string;
  location?: string;
  limit?: number;
  campaignId?: string;
}

export async function searchPeople(params: SearchPeopleParams): Promise<Record<string, unknown>[]> {
  const body: Record<string, unknown> = { limit: params.limit ?? 25 };

  if (params.company_domain) body.company_domain = params.company_domain;
  if (params.company_name) body.company_name = params.company_name;
  if (params.titles) body.titles = params.titles;
  if (params.seniority) body.seniority = params.seniority;
  if (params.department) body.department = params.department;
  if (params.location) body.location = params.location;

  const data = await client.request<{ results?: unknown[]; data?: unknown[] }>(
    "people/search",
    { body, campaignId: params.campaignId },
  );
  return (data.results ?? data.data ?? []) as Record<string, unknown>[];
}

export async function enrichPerson(
  opts: { email?: string; linkedin_url?: string; campaignId?: string },
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {};
  if (opts.email) params.email = opts.email;
  if (opts.linkedin_url) params.linkedin_url = opts.linkedin_url;
  if (!opts.email && !opts.linkedin_url) throw new Error("Must provide email or linkedin_url");

  return client.request("people/enrich", {
    method: "GET",
    params,
    campaignId: opts.campaignId,
  });
}

// --- Normalizers ---

export function normalizeCompany(raw: Record<string, unknown>): Omit<UpsertCompanyInput, "domain"> & { domain: string } {
  return {
    name: (raw.name as string) ?? "",
    domain: (raw.domain as string) ?? "",
    website: (raw.website as string) ?? `https://${(raw.domain as string) ?? ""}`,
    industry: (raw.industry as string) ?? "",
    employee_count: raw.employee_count as number | undefined,
    employee_count_range: (raw.employee_count_range as string) ?? "",
    revenue_range: (raw.revenue_range as string) ?? "",
    founded_year: raw.founded_year as number | undefined,
    location: (raw.location as string) ?? "",
    city: (raw.city as string) ?? "",
    state: (raw.state as string) ?? "",
    country: (raw.country as string) ?? "",
    tech_stack: (raw.technologies as string[]) ?? [],
    source_api: "parallel",
    enrichment_data: raw,
  };
}

const SENIORITY_MAP: Record<string, Seniority> = {
  "c-suite": "c_suite",
  c_suite: "c_suite",
  executive: "c_suite",
  founder: "c_suite",
  vp: "vp",
  "vice president": "vp",
  director: "director",
  manager: "manager",
  senior: "individual",
  entry: "individual",
  individual: "individual",
};

export function normalizePerson(raw: Record<string, unknown>): Omit<UpsertContactInput, "company_id"> {
  const rawSeniority = ((raw.seniority as string) ?? "").toLowerCase();
  return {
    first_name: (raw.first_name as string) ?? "",
    last_name: (raw.last_name as string) ?? "",
    full_name: (raw.full_name as string) ?? "",
    email: raw.email as string | undefined,
    linkedin_url: raw.linkedin_url as string | undefined,
    title: (raw.title as string) ?? "",
    seniority: SENIORITY_MAP[rawSeniority] ?? "individual",
    department: (raw.department as string) ?? "",
    source_api: "parallel",
    enrichment_data: raw,
  };
}
