import type { Channel } from "../types/message.js";
import type { CreateMessageInput } from "../types/message.js";
import { getCampaignById } from "../db/campaigns.js";
import { getCampaignContacts, updateCampaignContact } from "../db/campaign-contacts.js";
import { createMessagesBatch, updateMessage } from "../db/messages.js";
import { getQueuedMessagesForDispatch } from "../db/messages.js";
import { logActivity, getDailySendCount } from "../db/tool-usage.js";
import {
  sendEmail,
  sendLinkedInConnection,
  sendLinkedInMessage,
} from "../apis/unipile.js";
import { DAILY_LIMITS } from "../types/api.js";

export interface PrepareOutreachOptions {
  campaignId: string;
  accountId: string;
}

export interface PrepareOutreachResult {
  messages_prepared: number;
  by_channel: Record<string, number>;
}

/**
 * Simple deterministic hash of a string to a non-negative integer.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Schedule a message during business hours (9am-6pm UTC, skip weekends).
 * Spreads messages across future business-hour slots starting from now.
 */
function nextBusinessSlot(index: number): string {
  const now = new Date();
  // Start at next full minute
  const base = new Date(now.getTime() + 60_000);
  // Spread messages 2 minutes apart
  const candidate = new Date(base.getTime() + index * 2 * 60_000);

  // Adjust to business hours
  let d = new Date(candidate);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const day = d.getUTCDay();
    const hour = d.getUTCHours();

    // Skip weekends
    if (day === 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(9, 0, 0, 0);
      continue;
    }
    if (day === 6) {
      d.setUTCDate(d.getUTCDate() + 2);
      d.setUTCHours(9, 0, 0, 0);
      continue;
    }

    // Before business hours
    if (hour < 9) {
      d.setUTCHours(9, 0, 0, 0);
      continue;
    }

    // After business hours
    if (hour >= 18) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(9, 0, 0, 0);
      continue;
    }

    break;
  }

  return d.toISOString();
}

/**
 * Replace personalization tokens in a template string.
 */
function personalize(
  template: string,
  data: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

export async function prepareOutreach(
  options: PrepareOutreachOptions,
): Promise<PrepareOutreachResult> {
  const campaign = await getCampaignById(options.campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${options.campaignId}`);

  const copyVariants = campaign.copy_variants as Record<
    string,
    { subject?: string; body: string }
  > | null;
  const variantKeys = copyVariants ? Object.keys(copyVariants) : [];
  if (variantKeys.length === 0) {
    throw new Error(`Campaign ${options.campaignId} has no copy_variants`);
  }

  const contacts = await getCampaignContacts(options.campaignId, "pending");

  const messagesToCreate: CreateMessageInput[] = [];
  const byChannel: Record<string, number> = {};
  const queuedCampaignContactIds = new Set<string>();
  let slotIndex = 0;

  for (const cc of contacts) {
    const contact = cc.contacts;
    if (!contact) continue;

    // Determine channel
    let channel: Channel;
    if (contact.email && contact.email_verified) {
      channel = "email";
    } else if (contact.linkedin_url) {
      channel = "linkedin_connection";
    } else {
      continue; // skip contacts with no reachable channel
    }

    // Deterministic A/B variant assignment
    const variantIndex = simpleHash(cc.id) % variantKeys.length;
    const variantKey = variantKeys[variantIndex];
    const variant = copyVariants![variantKey];

    // Personalization data
    const personalizationData: Record<string, string> = {
      first_name: contact.first_name ?? "",
      company_name: contact.companies?.name ?? "",
      signal_detail: "",
    };

    // Extract signal_detail from company signals if available
    if (contact.companies?.signals_found) {
      const signals = contact.companies.signals_found;
      const firstSignalKey = Object.keys(signals)[0];
      if (firstSignalKey) {
        personalizationData.signal_detail = String(
          signals[firstSignalKey] ?? "",
        );
      }
    }

    const body = personalize(variant.body, personalizationData);
    const subject = variant.subject
      ? personalize(variant.subject, personalizationData)
      : undefined;

    messagesToCreate.push({
      campaign_contact_id: cc.id,
      channel,
      sequence_step: 1,
      copy_variant: variantKey,
      subject,
      body,
      personalization_data: personalizationData,
      status: "queued",
      scheduled_at: nextBusinessSlot(slotIndex),
    });

    queuedCampaignContactIds.add(cc.id);
    byChannel[channel] = (byChannel[channel] ?? 0) + 1;
    slotIndex++;
  }

  if (messagesToCreate.length > 0) {
    await createMessagesBatch(messagesToCreate);
    for (const campaignContactId of queuedCampaignContactIds) {
      await updateCampaignContact(campaignContactId, { status: "active" });
    }
  }

  return {
    messages_prepared: messagesToCreate.length,
    by_channel: byChannel,
  };
}

export async function sendQueuedMessages(
  accountId: string,
  maxBatch = 50,
): Promise<{ sent: number; failed: number }> {
  const messages = await getQueuedMessagesForDispatch(maxBatch);

  let sent = 0;
  let failed = 0;

  const markMessageFailed = async (messageId: string, errorMessage: string): Promise<void> => {
    await updateMessage(messageId, {
      status: "failed",
      error: errorMessage,
    });
  };

  for (const msg of messages) {
    // Check daily limit
    const dailyCount = await getDailySendCount(accountId, msg.channel);
    const limit = DAILY_LIMITS[msg.channel] ?? 50;

    if (dailyCount >= limit) {
      continue; // skip, at daily limit for this channel
    }

    try {
      let externalId: string | undefined;

      if (msg.channel === "email") {
        if (!msg.contact_email) {
          await markMessageFailed(msg.id, "Missing recipient email for queued email message");
          failed++;
          continue;
        }

        const result = await sendEmail({
          to: msg.contact_email,
          subject: msg.subject ?? "",
          body: msg.body,
          accountId,
          campaignId: msg.campaign_id,
        });
        externalId = result.id;
      } else if (msg.channel === "linkedin_connection") {
        if (!msg.contact_linkedin_url) {
          await markMessageFailed(msg.id, "Missing recipient LinkedIn profile for connection request");
          failed++;
          continue;
        }

        const result = await sendLinkedInConnection({
          profileUrl: msg.contact_linkedin_url,
          message: msg.body,
          accountId,
          campaignId: msg.campaign_id,
        });
        externalId = result.id;
      } else if (msg.channel === "linkedin_dm") {
        if (!msg.contact_linkedin_url) {
          await markMessageFailed(msg.id, "Missing recipient LinkedIn profile for DM");
          failed++;
          continue;
        }

        const result = await sendLinkedInMessage({
          profileUrl: msg.contact_linkedin_url,
          message: msg.body,
          accountId,
          campaignId: msg.campaign_id,
        });
        externalId = result.id;
      }

      const sentAt = new Date().toISOString();
      await updateMessage(msg.id, {
        status: "sent",
        sent_at: sentAt,
        unipile_message_id: externalId,
        unipile_account_id: accountId,
      });

      await logActivity({
        channel: msg.channel,
        action: msg.channel === "linkedin_connection" ? "connect" : "send",
        account_id: accountId,
        message_id: msg.id,
      });

      sent++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await markMessageFailed(msg.id, errorMessage);

      failed++;
    }

    // Small delay between sends
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return { sent, failed };
}
