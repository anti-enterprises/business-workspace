import { query, queryOne, queryMany } from './client.js';
import type {
  Campaign,
  CampaignWithOffer,
  CreateCampaignInput,
  UpdateCampaignInput,
} from '../types/campaign.js';

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const result = await query<Campaign>(
    `INSERT INTO campaigns (offer_id, slug, name, signal_type, signal_config, messaging_framework)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.offer_id,
      input.slug,
      input.name,
      input.signal_type ?? null,
      input.signal_config ? JSON.stringify(input.signal_config) : null,
      input.messaging_framework ?? null,
    ]
  );
  return result.rows[0];
}

export async function getCampaign(
  offerId: string,
  slug: string
): Promise<Campaign | null> {
  return queryOne<Campaign>(
    'SELECT * FROM campaigns WHERE offer_id = $1 AND slug = $2',
    [offerId, slug]
  );
}

export async function getCampaignById(
  campaignId: string
): Promise<CampaignWithOffer | null> {
  const row = await queryOne<
    Campaign & {
      offer_id: string;
      offer_slug: string;
      offer_name: string;
      icp: unknown;
      positioning: unknown;
    }
  >(
    `SELECT c.*,
            o.id AS offer_id,
            o.slug AS offer_slug,
            o.name AS offer_name,
            o.icp,
            o.positioning
     FROM campaigns c
     JOIN offers o ON o.id = c.offer_id
     WHERE c.id = $1`,
    [campaignId]
  );

  if (!row) return null;

  const { offer_slug, offer_name, icp, positioning, ...campaign } = row;

  return {
    ...campaign,
    offers: {
      id: row.offer_id,
      slug: offer_slug,
      name: offer_name,
      icp,
      positioning,
    },
  } as CampaignWithOffer;
}

export async function updateCampaign(
  campaignId: string,
  updates: UpdateCampaignInput
): Promise<Campaign | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex}`);
    values.push(updates.name);
    paramIndex++;
  }

  if (updates.signal_type !== undefined) {
    setClauses.push(`signal_type = $${paramIndex}`);
    values.push(updates.signal_type);
    paramIndex++;
  }

  if (updates.signal_config !== undefined) {
    setClauses.push(`signal_config = $${paramIndex}`);
    values.push(JSON.stringify(updates.signal_config));
    paramIndex++;
  }

  if (updates.messaging_framework !== undefined) {
    setClauses.push(`messaging_framework = $${paramIndex}`);
    values.push(updates.messaging_framework);
    paramIndex++;
  }

  if (updates.copy_variants !== undefined) {
    setClauses.push(`copy_variants = $${paramIndex}`);
    values.push(JSON.stringify(updates.copy_variants));
    paramIndex++;
  }

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex}`);
    values.push(updates.status);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    return queryOne<Campaign>('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
  }

  setClauses.push(`updated_at = now()`);
  values.push(campaignId);

  return queryOne<Campaign>(
    `UPDATE campaigns SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
}

export async function listCampaigns(offerId: string): Promise<Campaign[]> {
  return queryMany<Campaign>(
    'SELECT * FROM campaigns WHERE offer_id = $1 ORDER BY created_at DESC',
    [offerId]
  );
}
