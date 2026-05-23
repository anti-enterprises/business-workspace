import { query, queryOne, queryMany } from './client.js';
import type { Offer, CreateOfferInput, UpdateOfferInput } from '../types/offer.js';

export async function createOffer(input: CreateOfferInput): Promise<Offer> {
  const result = await query<Offer>(
    `INSERT INTO offers (slug, name, description, positioning, icp)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.slug,
      input.name,
      input.description ?? null,
      input.positioning ? JSON.stringify(input.positioning) : null,
      input.icp ? JSON.stringify(input.icp) : null,
    ]
  );
  return result.rows[0];
}

export async function getOffer(slug: string): Promise<Offer | null> {
  return queryOne<Offer>('SELECT * FROM offers WHERE slug = $1', [slug]);
}

export async function updateOffer(
  slug: string,
  updates: UpdateOfferInput
): Promise<Offer | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex}`);
    values.push(updates.name);
    paramIndex++;
  }

  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIndex}`);
    values.push(updates.description);
    paramIndex++;
  }

  if (updates.positioning !== undefined) {
    setClauses.push(`positioning = $${paramIndex}`);
    values.push(JSON.stringify(updates.positioning));
    paramIndex++;
  }

  if (updates.icp !== undefined) {
    setClauses.push(`icp = $${paramIndex}`);
    values.push(JSON.stringify(updates.icp));
    paramIndex++;
  }

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex}`);
    values.push(updates.status);
    paramIndex++;
  }

  if (setClauses.length === 0) return getOffer(slug);

  setClauses.push(`updated_at = now()`);
  values.push(slug);

  return queryOne<Offer>(
    `UPDATE offers SET ${setClauses.join(', ')} WHERE slug = $${paramIndex} RETURNING *`,
    values
  );
}

export async function listOffers(status?: string): Promise<Offer[]> {
  if (status) {
    return queryMany<Offer>(
      'SELECT * FROM offers WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );
  }
  return queryMany<Offer>('SELECT * FROM offers ORDER BY created_at DESC');
}
