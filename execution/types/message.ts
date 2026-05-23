export const CHANNELS = [
  "email",
  "linkedin_connection",
  "linkedin_dm",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const MESSAGE_STATUSES = [
  "draft",
  "queued",
  "sending",
  "sent",
  "delivered",
  "opened",
  "replied",
  "failed",
  "bounced",
  "cancelled",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const REPLY_SENTIMENTS = [
  "positive",
  "negative",
  "neutral",
  "out_of_office",
] as const;
export type ReplySentiment = (typeof REPLY_SENTIMENTS)[number];

export interface Message {
  id: string;
  campaign_contact_id: string;
  channel: Channel;
  sequence_step: number;
  copy_variant: string | null;
  subject: string | null;
  body: string;
  personalization_data: Record<string, unknown> | null;
  status: MessageStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  reply_content: string | null;
  reply_sentiment: ReplySentiment | null;
  error: string | null;
  retry_count: number;
  max_retries: number;
  unipile_message_id: string | null;
  unipile_account_id: string | null;
  created_at: string;
}

export interface CreateMessageInput {
  campaign_contact_id: string;
  channel: Channel;
  sequence_step?: number;
  copy_variant?: string;
  subject?: string;
  body: string;
  personalization_data?: Record<string, unknown>;
  status?: MessageStatus;
  scheduled_at?: string;
}

export interface UpdateMessageInput {
  status?: MessageStatus;
  sent_at?: string;
  delivered_at?: string;
  opened_at?: string;
  replied_at?: string;
  reply_content?: string;
  reply_sentiment?: ReplySentiment;
  error?: string;
  retry_count?: number;
  unipile_message_id?: string;
  unipile_account_id?: string;
}
