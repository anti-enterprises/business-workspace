import { getCampaignById, updateCampaign } from "../db/campaigns.js";
import { getQualifiedCompanies } from "../db/companies.js";
import { upsertContact, contactAlreadyMessaged } from "../db/contacts.js";
import { addContactToCampaign } from "../db/campaign-contacts.js";
import { searchPeople, normalizePerson } from "../apis/parallel.js";
import { verifyEmail, findPhone } from "../apis/leadmagic.js";
import type { BuyerProfile } from "../types/offer.js";
import type { Company } from "../types/company.js";

export interface FindContactsOptions {
  campaignId: string;
  minFitScore?: number;
  maxCompanies?: number;
  maxContactsPerCompany?: number;
  findPhones?: boolean;
  verifyEmails?: boolean;
}

export interface FindContactsResult {
  companies_processed: number;
  contacts_found: number;
  contacts_verified: number;
  contacts_saved: number;
  contacts_skipped_dedup: number;
  contacts_skipped_no_email: number;
  contacts_skipped_invalid_email: number;
}

const DEFAULT_SENIORITY = ["c_suite", "vp", "director", "manager"];
const DEFAULT_TITLES = ["CEO", "CTO", "VP Engineering", "Head of Engineering", "Director of Engineering"];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findContacts(options: FindContactsOptions): Promise<FindContactsResult> {
  const {
    campaignId,
    minFitScore = 60,
    maxCompanies = 100,
    maxContactsPerCompany = 3,
    findPhones: shouldFindPhones = false,
    verifyEmails: shouldVerifyEmails = true,
  } = options;

  const stats: FindContactsResult = {
    companies_processed: 0,
    contacts_found: 0,
    contacts_verified: 0,
    contacts_saved: 0,
    contacts_skipped_dedup: 0,
    contacts_skipped_no_email: 0,
    contacts_skipped_invalid_email: 0,
  };

  // 1. Load campaign and extract buyer profile
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const icp = campaign.offers?.icp as { buyer_profile?: BuyerProfile } | null;
  const buyerProfile: BuyerProfile = icp?.buyer_profile ?? {};

  const titles = buyerProfile.titles?.length
    ? buyerProfile.titles
    : DEFAULT_TITLES;

  const seniority = buyerProfile.seniority?.length
    ? buyerProfile.seniority
    : DEFAULT_SENIORITY;

  const department = buyerProfile.department;

  console.log(`[contact-finder] Starting for campaign ${campaignId}`);
  console.log(`[contact-finder] Searching titles: ${titles.join(", ")}`);
  console.log(`[contact-finder] Seniority: ${seniority.join(", ")}`);

  // 2. Get qualified companies
  const companies = await getQualifiedCompanies(campaignId, minFitScore, maxCompanies);
  console.log(`[contact-finder] Found ${companies.length} qualified companies`);

  if (companies.length === 0) {
    return stats;
  }

  // 3. Process each company
  for (const company of companies) {
    try {
      await processCompany(
        company,
        campaignId,
        titles,
        seniority,
        department,
        maxContactsPerCompany,
        shouldVerifyEmails,
        shouldFindPhones,
        stats,
      );
    } catch (err) {
      console.log(
        `[contact-finder] Error processing company ${company.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    stats.companies_processed++;

    // Small delay between companies
    if (stats.companies_processed < companies.length) {
      await delay(500);
    }
  }

  // 4. Update campaign status
  try {
    await updateCampaign(campaignId, { status: "active" });
  } catch (err) {
    console.log(
      `[contact-finder] Failed to update campaign status: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(`[contact-finder] Complete. Stats:`, stats);
  return stats;
}

async function processCompany(
  company: Company,
  campaignId: string,
  titles: string[],
  seniority: string[],
  department: string | undefined,
  maxContactsPerCompany: number,
  shouldVerifyEmails: boolean,
  shouldFindPhones: boolean,
  stats: FindContactsResult,
): Promise<void> {
  if (!company.domain) {
    console.log(`[contact-finder] Skipping ${company.name}: no domain`);
    return;
  }

  console.log(`[contact-finder] Searching contacts at ${company.name} (${company.domain})`);

  // Search for people at this company
  const people = await searchPeople({
    company_domain: company.domain,
    titles,
    seniority,
    department,
    limit: 10,
    campaignId,
  });

  if (people.length === 0) {
    console.log(`[contact-finder] No people found at ${company.name}`);
    return;
  }

  let savedCount = 0;

  for (const rawPerson of people) {
    if (savedCount >= maxContactsPerCompany) break;

    try {
      const person = normalizePerson(rawPerson);
      stats.contacts_found++;

      // Check for email
      if (!person.email) {
        stats.contacts_skipped_no_email++;
        continue;
      }

      // Global dedup check
      const alreadyMessaged = await contactAlreadyMessaged(
        person.email,
        person.linkedin_url ?? undefined,
      );
      if (alreadyMessaged) {
        stats.contacts_skipped_dedup++;
        continue;
      }

      // Verify email if enabled
      let emailVerified = false;
      if (shouldVerifyEmails) {
        try {
          const verification = await verifyEmail(person.email, campaignId);
          stats.contacts_verified++;

          if (!verification.is_valid && !verification.is_catch_all) {
            stats.contacts_skipped_invalid_email++;
            continue;
          }

          emailVerified = verification.is_valid || verification.is_deliverable;
        } catch (err) {
          console.log(
            `[contact-finder] Email verification failed for ${person.email}: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Continue without verification — don't skip the contact
        }
      }

      // Find phone if enabled
      let phone: string | undefined;
      let phoneType: string | undefined;
      if (shouldFindPhones && person.linkedin_url) {
        try {
          const phoneResult = await findPhone({
            linkedin_url: person.linkedin_url,
            campaignId,
          });
          if (phoneResult.found) {
            phone = phoneResult.phone;
            phoneType = phoneResult.phone_type;
          }
        } catch (err) {
          console.log(
            `[contact-finder] Phone lookup failed for ${person.linkedin_url}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Save contact
      const contact = await upsertContact({
        company_id: company.id,
        first_name: person.first_name,
        last_name: person.last_name,
        full_name: person.full_name,
        email: person.email,
        email_verified: emailVerified,
        email_verification_date: emailVerified ? new Date().toISOString() : undefined,
        email_verification_source: shouldVerifyEmails ? "leadmagic" : undefined,
        phone,
        phone_type: phoneType,
        linkedin_url: person.linkedin_url ?? undefined,
        title: person.title,
        seniority: person.seniority,
        department: person.department,
        source_api: person.source_api ?? "parallel",
        enrichment_data: person.enrichment_data ?? undefined,
      });

      // Link to campaign
      await addContactToCampaign(campaignId, contact.id);
      stats.contacts_saved++;
      savedCount++;

      console.log(
        `[contact-finder] Saved contact: ${person.full_name} (${person.email}) at ${company.name}`,
      );
    } catch (err) {
      console.log(
        `[contact-finder] Error processing contact at ${company.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
