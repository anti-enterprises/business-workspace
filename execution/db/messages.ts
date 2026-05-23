import { reconcileCampaignContactFromMessageEvent } from "./campaign-contacts.js";
import { query, queryOne, queryMany } from "./client.js";
import type {
  Message,
  CreateMessageInput,
  UpdateMessageInput,
} from "../types/message.js";

interface CreateMessageField {
  column: string;
  read: (input: CreateMessageInput) => unknown;
  json?: boolean;
}

const CREATE_MESSAGE_FIELDS: CreateMessageField[] = [
  { column: "campaign_contact_id", read: (input) => input.campaign_contact_id },
  { column: "channel", read: (input) => input.channel },
  { column: "sequence_step", read: (input) => input.sequence_step },
  { column: "copy_variant", read: (input) => input.copy_variant },
  { column: "subject", read: (input) => input.subject },
  { column: "body", read: (input) => input.body },
  {
    column: "personalization_data",
    read: (input) => input.personalization_data,
    json: true,
  },
  { column: "status", read: (input) => input.status },
  { column: "scheduled_at", read: (input) => input.scheduled_at },
];

function toDbValue(value: unknown, json = false): unknown {
  if (value === undefined) return undefined;
  return json ? JSON.stringify(value) : value;
}

export async function createMessage(input: CreateMessageInput): Promise<Message> {
  const fields: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const field of CREATE_MESSAGE_FIELDS) {
    const value = toDbValue(field.read(input), field.json);
    if (value === undefined) continue;

    fields.push(field.column);
    placeholders.push(`$${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  const result = await query<Message>(
    `INSERT INTO messages (${fields.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function createMessagesBatch(
  messages: CreateMessageInput[],
): Promise<Message[]> {
  if (messages.length === 0) return [];

  const jsonFields = new Set(["personalization_data"]);
  const allFields = [
    "campaign_contact_id",
    "channel",
    "sequence_step",
    "copy_variant",
    "subject",
    "body",
    "personalization_data",
    "status",
    "scheduled_at",
  ];

  const valueRows: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const msg of messages) {
    const row: string[] = [];
    for (const field of allFields) {
      const value = (msg as unknown as Record<string, unknown>)[field];
      row.push(`$${paramIndex}`);
      if (value === undefined) {
        values.push(null);
      } else if (jsonFields.has(field)) {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
      paramIndex++;
    }
    valueRows.push(`(${row.join(', ')})`);
  }

  const result = await query<Message>(
    `INSERT INTO messages (${allFields.join(', ')})
     VALUES ${valueRows.join(', ')}
     RETURNING *`,
    values
  );
  return result.rows;
}

export async function getQueuedMessages(
  limit?: number,
  before?: Date,
): Promise<Message[]> {
  const cutoff = before ?? new Date();
  return queryMany<Message>(
    `SELECT * FROM messages
     WHERE status = 'queued' AND scheduled_at <= $1
     ORDER BY scheduled_at
     LIMIT $2`,
    [cutoff.toISOString(), limit ?? 50]
  );
}

export interface QueuedDispatchMessage extends Message {
  campaign_id: string;
  contact_email: string | null;
  contact_linkedin_url: string | null;
}

export async function getQueuedMessagesForDispatch(
  limit?: number,
  before?: Date,
): Promise<QueuedDispatchMessage[]> {
  const cutoff = before ?? new Date();
  return queryMany<QueuedDispatchMessage>(
    `SELECT
       m.*,
       cc.campaign_id,
       co.email AS contact_email,
       co.linkedin_url AS contact_linkedin_url
     FROM messages m
     JOIN campaign_contacts cc ON cc.id = m.campaign_contact_id
     JOIN contacts co ON co.id = cc.contact_id
     WHERE m.status = 'queued' AND m.scheduled_at <= $1
     ORDER BY m.scheduled_at
     LIMIT $2`,
    [cutoff.toISOString(), limit ?? 50]
  );
}

export async function updateMessage(
  messageId: string,
  updates: UpdateMessageInput,
): Promise<Message | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex}`);
    values.push(updates.status);
    paramIndex++;
  }

  if (updates.sent_at !== undefined) {
    setClauses.push(`sent_at = $${paramIndex}`);
    values.push(updates.sent_at);
    paramIndex++;
  }

  if (updates.delivered_at !== undefined) {
    setClauses.push(`delivered_at = $${paramIndex}`);
    values.push(updates.delivered_at);
    paramIndex++;
  }

  if (updates.opened_at !== undefined) {
    setClauses.push(`opened_at = $${paramIndex}`);
    values.push(updates.opened_at);
    paramIndex++;
  }

  if (updates.replied_at !== undefined) {
    setClauses.push(`replied_at = $${paramIndex}`);
    values.push(updates.replied_at);
    paramIndex++;
  }

  if (updates.reply_content !== undefined) {
    setClauses.push(`reply_content = $${paramIndex}`);
    values.push(updates.reply_content);
    paramIndex++;
  }

  if (updates.reply_sentiment !== undefined) {
    setClauses.push(`reply_sentiment = $${paramIndex}`);
    values.push(updates.reply_sentiment);
    paramIndex++;
  }

  if (updates.error !== undefined) {
    setClauses.push(`error = $${paramIndex}`);
    values.push(updates.error);
    paramIndex++;
  }

  if (updates.retry_count !== undefined) {
    setClauses.push(`retry_count = $${paramIndex}`);
    values.push(updates.retry_count);
    paramIndex++;
  }

  if (updates.unipile_message_id !== undefined) {
    setClauses.push(`unipile_message_id = $${paramIndex}`);
    values.push(updates.unipile_message_id);
    paramIndex++;
  }

  if (updates.unipile_account_id !== undefined) {
    setClauses.push(`unipile_account_id = $${paramIndex}`);
    values.push(updates.unipile_account_id);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    return queryOne<Message>(
      "SELECT * FROM messages WHERE id = $1",
      [messageId],
    );
  }

  values.push(messageId);

  const updated = await queryOne<Message>(
    `UPDATE messages SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );

  if (updated && updates.status !== undefined) {
    const lifecycleTimestamp =
      updates.replied_at ??
      updates.opened_at ??
      updates.delivered_at ??
      updates.sent_at;

    await reconcileCampaignContactFromMessageEvent(
      updated.campaign_contact_id,
      updates.status,
      lifecycleTimestamp ?? undefined,
    );
  }

  return updated;
}

export async function getCampaignMessages(
  campaignId: string,
  channel?: string,
): Promise<Message[]> {
  const conditions = ["cc.campaign_id = $1"];
  const values: unknown[] = [campaignId];

  if (channel) {
    conditions.push("m.channel = $2");
    values.push(channel);
  }

  return queryMany<Message>(
    `SELECT m.* FROM messages m
     JOIN campaign_contacts cc ON m.campaign_contact_id = cc.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY m.created_at`,
    values
  );
}
