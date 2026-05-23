import { getEnv } from "../config/env.js";
import { BaseApiClient } from "./base-client.js";

class LeadMagicClient extends BaseApiClient {
  protected readonly apiName = "leadmagic";
  protected readonly baseUrl = "https://api.leadmagic.io/v1";
  protected readonly timeout = 30000;

  protected getHeaders() {
    const key = getEnv().LEADMAGIC_API_KEY;
    if (!key) throw new Error("LEADMAGIC_API_KEY not set");
    return {
      "X-API-Key": key,
      "Content-Type": "application/json",
    };
  }
}

const client = new LeadMagicClient();

// --- Response types ---

export interface EmailVerificationResult {
  email: string;
  is_valid: boolean;
  is_deliverable: boolean;
  is_catch_all: boolean;
  status: string;
  provider: string;
}

export interface EmailVerificationError {
  email: string;
  is_valid: false;
  status: "error";
  error: string;
}

export interface EmailFindResult {
  email: string;
  confidence: number;
  found: boolean;
}

export interface PhoneFindResult {
  phone: string;
  phone_type: string;
  found: boolean;
}

// --- Functions ---

export async function verifyEmail(
  email: string,
  campaignId?: string,
): Promise<EmailVerificationResult> {
  return client.request<EmailVerificationResult>("email/verify", {
    body: { email },
    campaignId,
  });
}

export async function verifyEmailsBatch(
  emails: string[],
  campaignId?: string,
): Promise<(EmailVerificationResult | EmailVerificationError)[]> {
  const results: (EmailVerificationResult | EmailVerificationError)[] = [];

  for (const email of emails) {
    try {
      const result = await verifyEmail(email, campaignId);
      results.push(result);
    } catch (err) {
      results.push({
        email,
        is_valid: false,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 200ms delay between requests
    if (email !== emails[emails.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}

export async function findEmail(
  firstName: string,
  lastName: string,
  domain: string,
  campaignId?: string,
): Promise<EmailFindResult> {
  return client.request<EmailFindResult>("email/find", {
    body: { first_name: firstName, last_name: lastName, domain },
    campaignId,
  });
}

export async function findPhone(
  opts: { linkedin_url?: string; email?: string; campaignId?: string },
): Promise<PhoneFindResult> {
  const body: Record<string, unknown> = {};
  if (opts.linkedin_url) body.linkedin_url = opts.linkedin_url;
  if (opts.email) body.email = opts.email;

  return client.request<PhoneFindResult>("phone/find", {
    body,
    campaignId: opts.campaignId,
  });
}

export async function enrichLinkedin(
  linkedinUrl: string,
  campaignId?: string,
): Promise<Record<string, unknown>> {
  return client.request<Record<string, unknown>>("linkedin/enrich", {
    body: { linkedin_url: linkedinUrl },
    campaignId,
  });
}
