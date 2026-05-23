import { query, queryOne, queryMany } from './client.js';
import type { Company, UpsertCompanyInput } from '../types/company.js';

export async function upsertCompany(input: UpsertCompanyInput): Promise<Company> {
  const result = await query<Company>(
    `INSERT INTO companies (
       name, domain, website, industry, employee_count, employee_count_range,
       revenue_range, founded_year, location, city, state, country,
       tech_stack, signals_found, fit_score, fit_notes,
       enrichment_data, source_api, source_campaign_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     ON CONFLICT (domain) DO UPDATE SET
       name = EXCLUDED.name,
       website = COALESCE(EXCLUDED.website, companies.website),
       industry = COALESCE(EXCLUDED.industry, companies.industry),
       employee_count = COALESCE(EXCLUDED.employee_count, companies.employee_count),
       employee_count_range = COALESCE(EXCLUDED.employee_count_range, companies.employee_count_range),
       revenue_range = COALESCE(EXCLUDED.revenue_range, companies.revenue_range),
       tech_stack = COALESCE(EXCLUDED.tech_stack, companies.tech_stack),
       signals_found = COALESCE(EXCLUDED.signals_found, companies.signals_found),
       fit_score = COALESCE(EXCLUDED.fit_score, companies.fit_score),
       enrichment_data = COALESCE(EXCLUDED.enrichment_data, companies.enrichment_data),
       source_api = COALESCE(EXCLUDED.source_api, companies.source_api),
       source_campaign_id = COALESCE(EXCLUDED.source_campaign_id, companies.source_campaign_id),
       updated_at = now()
     RETURNING *`,
    [
      input.name,
      input.domain,
      input.website ?? null,
      input.industry ?? null,
      input.employee_count ?? null,
      input.employee_count_range ?? null,
      input.revenue_range ?? null,
      input.founded_year ?? null,
      input.location ?? null,
      input.city ?? null,
      input.state ?? null,
      input.country ?? null,
      input.tech_stack ? JSON.stringify(input.tech_stack) : null,
      input.signals_found ? JSON.stringify(input.signals_found) : null,
      input.fit_score ?? null,
      input.fit_notes ?? null,
      input.enrichment_data ? JSON.stringify(input.enrichment_data) : null,
      input.source_api ?? null,
      input.source_campaign_id ?? null,
    ]
  );
  return result.rows[0];
}

export async function getCompanyByDomain(domain: string): Promise<Company | null> {
  return queryOne<Company>('SELECT * FROM companies WHERE domain = $1', [domain]);
}

export async function getQualifiedCompanies(
  campaignId: string,
  minFitScore = 60,
  limit = 100
): Promise<Company[]> {
  return queryMany<Company>(
    `SELECT * FROM companies
     WHERE source_campaign_id = $1
       AND disqualified = false
       AND fit_score >= $2
     ORDER BY fit_score DESC
     LIMIT $3`,
    [campaignId, minFitScore, limit]
  );
}

export async function disqualifyCompany(
  companyId: string,
  reason: string
): Promise<Company | null> {
  return queryOne<Company>(
    `UPDATE companies
     SET disqualified = true, disqualification_reason = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [companyId, reason]
  );
}

export async function companyExists(domain: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>('SELECT id FROM companies WHERE domain = $1', [
    domain,
  ]);
  return row !== null;
}
