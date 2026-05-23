import { getEnv } from "../config/env.js";
import { BaseApiClient } from "./base-client.js";
import type { UpsertCompanyInput } from "../types/company.js";

class TheirStackClient extends BaseApiClient {
  protected readonly apiName = "theirstack";
  protected readonly baseUrl = "https://api.theirstack.com/v1";
  protected readonly timeout = 30000;

  protected getHeaders() {
    const key = getEnv().THEIRSTACK_API_KEY;
    if (!key) throw new Error("THEIRSTACK_API_KEY not set");
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }
}

const client = new TheirStackClient();

export interface SearchJobsParams {
  job_title_contains?: string[];
  job_title_not_contains?: string[];
  company_name?: string;
  company_domain?: string;
  company_size_min?: number;
  company_size_max?: number;
  company_industry?: string;
  company_country?: string;
  posted_after?: string;
  posted_before?: string;
  remote?: boolean;
  limit?: number;
  page?: number;
  campaignId?: string;
}

export async function searchJobs(params: SearchJobsParams): Promise<Record<string, unknown>[]> {
  const body: Record<string, unknown> = {
    limit: params.limit ?? 50,
    page: params.page ?? 1,
  };

  if (params.job_title_contains) body.job_title_or = params.job_title_contains;
  if (params.job_title_not_contains) body.job_title_not = params.job_title_not_contains;
  if (params.company_name) body.company_name = params.company_name;
  if (params.company_domain) body.company_domain = params.company_domain;
  if (params.company_size_min != null) body.min_employees = params.company_size_min;
  if (params.company_size_max != null) body.max_employees = params.company_size_max;
  if (params.company_industry) body.company_industry_or = [params.company_industry];
  if (params.company_country) body.company_country_or = [params.company_country];
  if (params.posted_after) body.posted_at_min_date = params.posted_after;
  if (params.posted_before) body.posted_at_max_date = params.posted_before;
  if (params.remote != null) body.remote = params.remote;

  const data = await client.request<{ data?: unknown[] }>(
    "jobs/search",
    { body, campaignId: params.campaignId },
  );
  return (data.data ?? []) as Record<string, unknown>[];
}

export async function getCompanyJobs(
  companyDomain: string,
  limit = 50,
  campaignId?: string,
): Promise<Record<string, unknown>[]> {
  return searchJobs({ company_domain: companyDomain, limit, campaignId });
}

// --- Signal extraction ---

export interface HiringSignals {
  total_open_roles: number;
  departments: Record<string, number>;
  seniority_breakdown: Record<string, number>;
  notable_roles: string[];
  signal_strength: "strong" | "moderate" | "weak" | "none";
  signal_summary: string;
}

export function extractHiringSignals(jobs: Record<string, unknown>[]): HiringSignals {
  if (jobs.length === 0) {
    return {
      total_open_roles: 0,
      departments: {},
      seniority_breakdown: {},
      notable_roles: [],
      signal_strength: "none",
      signal_summary: "No open roles found.",
    };
  }

  const departments: Record<string, number> = {};
  const seniority: Record<string, number> = {};
  const notable: string[] = [];

  for (const job of jobs) {
    const title = ((job.job_title as string) ?? "").toLowerCase();
    const dept = classifyDepartment(title);
    departments[dept] = (departments[dept] ?? 0) + 1;

    const sen = classifyJobSeniority(title);
    seniority[sen] = (seniority[sen] ?? 0) + 1;

    if (["vp", "c_suite", "director"].includes(sen)) {
      notable.push((job.job_title as string) ?? "");
    }
  }

  const total = jobs.length;
  const strength: HiringSignals["signal_strength"] =
    total >= 10 ? "strong" : total >= 5 ? "moderate" : "weak";

  const topDept = Object.entries(departments).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  let summary = `Hiring ${total} roles, primarily in ${topDept} (${departments[topDept] ?? 0} roles).`;
  if (notable.length > 0) {
    summary += ` Notable: ${notable.slice(0, 3).join(", ")}.`;
  }

  return {
    total_open_roles: total,
    departments,
    seniority_breakdown: seniority,
    notable_roles: notable.slice(0, 5),
    signal_strength: strength,
    signal_summary: summary,
  };
}

function classifyDepartment(title: string): string {
  if (["sales", "sdr", "bdr", "account executive", "revenue"].some((w) => title.includes(w))) return "sales";
  if (["engineer", "developer", "devops", "sre", "backend", "frontend", "fullstack"].some((w) => title.includes(w))) return "engineering";
  if (["marketing", "growth", "content", "seo", "demand gen"].some((w) => title.includes(w))) return "marketing";
  if (["product", "pm", "product manager"].some((w) => title.includes(w))) return "product";
  if (["design", "ux", "ui"].some((w) => title.includes(w))) return "design";
  if (["data", "analyst", "analytics", "machine learning", "ai"].some((w) => title.includes(w))) return "data";
  if (["customer success", "support", "cx"].some((w) => title.includes(w))) return "customer_success";
  if (["hr", "people", "recruiting", "talent"].some((w) => title.includes(w))) return "people";
  if (["finance", "accounting", "controller"].some((w) => title.includes(w))) return "finance";
  return "other";
}

function classifyJobSeniority(title: string): string {
  if (["chief", "ceo", "cto", "cfo", "coo", "cmo", "cro"].some((w) => title.includes(w))) return "c_suite";
  if (["vp", "vice president"].some((w) => title.includes(w))) return "vp";
  if (title.includes("director") || title.includes("head of")) return "director";
  if (["manager", "lead", "principal"].some((w) => title.includes(w))) return "manager";
  if (title.includes("senior") || title.includes("sr")) return "senior";
  return "individual";
}

// --- Normalizer ---

export function normalizeCompanyFromJob(job: Record<string, unknown>): Omit<UpsertCompanyInput, "domain"> & { domain: string } {
  const company = (typeof job.company === "object" && job.company !== null ? job.company : {}) as Record<string, unknown>;
  return {
    name: (company.name as string) ?? (job.company_name as string) ?? "",
    domain: (company.domain as string) ?? (job.company_domain as string) ?? "",
    website: (company.website as string) ?? "",
    industry: (company.industry as string) ?? "",
    employee_count: (company.employee_count as number) ?? (job.company_num_employees as number) ?? undefined,
    location: (company.location as string) ?? "",
    country: (company.country as string) ?? (job.company_country as string) ?? "",
    source_api: "theirstack",
    enrichment_data: { theirstack_company: company, source_job: (job.job_title as string) ?? "" },
  };
}
