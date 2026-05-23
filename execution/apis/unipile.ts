import { getEnv } from "../config/env.js";
import { BaseApiClient } from "./base-client.js";

class UnipileClient extends BaseApiClient {
  protected readonly apiName = "unipile";
  protected readonly baseUrl: string;
  protected readonly timeout = 30000;

  constructor() {
    super();
    const dsn = getEnv().UNIPILE_DSN;
    if (!dsn) throw new Error("UNIPILE_DSN not set");
    this.baseUrl = `https://${dsn}.unipile.com/api/v1`;
  }

  protected getHeaders() {
    const key = getEnv().UNIPILE_API_KEY;
    if (!key) throw new Error("UNIPILE_API_KEY not set");
    return {
      "X-API-Key": key,
      "Content-Type": "application/json",
    };
  }
}

let _client: UnipileClient | null = null;

function getClient(): UnipileClient {
  if (!_client) {
    _client = new UnipileClient();
  }
  return _client;
}

// --- Exported functions ---

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  accountId: string;
  campaignId?: string;
}): Promise<{ id: string; status: string }> {
  return getClient().request<{ id: string; status: string }>(
    "messages/email",
    {
      body: {
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
        account_id: opts.accountId,
      },
      campaignId: opts.campaignId,
    },
  );
}

export async function sendLinkedInConnection(opts: {
  profileUrl: string;
  message?: string;
  accountId: string;
  campaignId?: string;
}): Promise<{ id: string; status: string }> {
  const reqBody: Record<string, unknown> = {
    profile_url: opts.profileUrl,
    account_id: opts.accountId,
  };
  if (opts.message) reqBody.message = opts.message;

  return getClient().request<{ id: string; status: string }>(
    "connections",
    { body: reqBody, campaignId: opts.campaignId },
  );
}

export async function sendLinkedInMessage(opts: {
  profileUrl: string;
  message: string;
  accountId: string;
  campaignId?: string;
}): Promise<{ id: string; status: string }> {
  return getClient().request<{ id: string; status: string }>(
    "messages/linkedin",
    {
      body: {
        profile_url: opts.profileUrl,
        message: opts.message,
        account_id: opts.accountId,
      },
      campaignId: opts.campaignId,
    },
  );
}

export async function getMessageStatus(
  messageId: string,
  campaignId?: string,
): Promise<{
  id: string;
  status: string;
  delivered_at?: string;
  opened_at?: string;
  replied_at?: string;
}> {
  return getClient().request<{
    id: string;
    status: string;
    delivered_at?: string;
    opened_at?: string;
    replied_at?: string;
  }>(`messages/${messageId}`, {
    method: "GET",
    campaignId,
  });
}
