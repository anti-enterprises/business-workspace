import { query, queryOne, queryMany } from './client.js';
import type { Contact, UpsertContactInput } from '../types/contact.js';

export async function upsertContact(input: UpsertContactInput): Promise<Contact> {
  // Try to find existing contact by email first, then linkedin_url
  let existing: Contact | null = null;

  if (input.email) {
    existing = await queryOne<Contact>(
      'SELECT * FROM contacts WHERE email = $1',
      [input.email]
    );
  }

  if (!existing && input.linkedin_url) {
    existing = await queryOne<Contact>(
      'SELECT * FROM contacts WHERE linkedin_url = $1',
      [input.linkedin_url]
    );
  }

  if (existing) {
    // UPDATE existing contact (allowlisted fields only)
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.first_name !== undefined) {
      setClauses.push(`first_name = $${paramIndex}`);
      values.push(input.first_name);
      paramIndex++;
    }

    if (input.last_name !== undefined) {
      setClauses.push(`last_name = $${paramIndex}`);
      values.push(input.last_name);
      paramIndex++;
    }

    if (input.full_name !== undefined) {
      setClauses.push(`full_name = $${paramIndex}`);
      values.push(input.full_name);
      paramIndex++;
    }

    if (input.email !== undefined) {
      setClauses.push(`email = $${paramIndex}`);
      values.push(input.email);
      paramIndex++;
    }

    if (input.email_verified !== undefined) {
      setClauses.push(`email_verified = $${paramIndex}`);
      values.push(input.email_verified);
      paramIndex++;
    }

    if (input.email_verification_date !== undefined) {
      setClauses.push(`email_verification_date = $${paramIndex}`);
      values.push(input.email_verification_date);
      paramIndex++;
    }

    if (input.email_verification_source !== undefined) {
      setClauses.push(`email_verification_source = $${paramIndex}`);
      values.push(input.email_verification_source);
      paramIndex++;
    }

    if (input.phone !== undefined) {
      setClauses.push(`phone = $${paramIndex}`);
      values.push(input.phone);
      paramIndex++;
    }

    if (input.phone_type !== undefined) {
      setClauses.push(`phone_type = $${paramIndex}`);
      values.push(input.phone_type);
      paramIndex++;
    }

    if (input.linkedin_url !== undefined) {
      setClauses.push(`linkedin_url = $${paramIndex}`);
      values.push(input.linkedin_url);
      paramIndex++;
    }

    if (input.linkedin_connected !== undefined) {
      setClauses.push(`linkedin_connected = $${paramIndex}`);
      values.push(input.linkedin_connected);
      paramIndex++;
    }

    if (input.title !== undefined) {
      setClauses.push(`title = $${paramIndex}`);
      values.push(input.title);
      paramIndex++;
    }

    if (input.seniority !== undefined) {
      setClauses.push(`seniority = $${paramIndex}`);
      values.push(input.seniority);
      paramIndex++;
    }

    if (input.department !== undefined) {
      setClauses.push(`department = $${paramIndex}`);
      values.push(input.department);
      paramIndex++;
    }

    if (input.enrichment_data !== undefined) {
      setClauses.push(`enrichment_data = $${paramIndex}`);
      values.push(JSON.stringify(input.enrichment_data));
      paramIndex++;
    }

    if (input.source_api !== undefined) {
      setClauses.push(`source_api = $${paramIndex}`);
      values.push(input.source_api);
      paramIndex++;
    }

    if (setClauses.length === 0) return existing;

    setClauses.push('updated_at = now()');
    values.push(existing.id);

    return (await queryOne<Contact>(
      `UPDATE contacts SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    ))!;
  }

  // INSERT new contact
  const fields = ['company_id'];
  const placeholders = ['$1'];
  const values: unknown[] = [input.company_id];
  let paramIndex = 2;

  const addInsertField = (field: string, value: unknown, json = false): void => {
    if (value === undefined) return;
    fields.push(field);
    placeholders.push(`$${paramIndex}`);
    values.push(json ? JSON.stringify(value) : value);
    paramIndex++;
  };

  addInsertField('first_name', input.first_name);
  addInsertField('last_name', input.last_name);
  addInsertField('full_name', input.full_name);
  addInsertField('email', input.email);
  addInsertField('email_verified', input.email_verified);
  addInsertField('email_verification_date', input.email_verification_date);
  addInsertField('email_verification_source', input.email_verification_source);
  addInsertField('phone', input.phone);
  addInsertField('phone_type', input.phone_type);
  addInsertField('linkedin_url', input.linkedin_url);
  addInsertField('linkedin_connected', input.linkedin_connected);
  addInsertField('title', input.title);
  addInsertField('seniority', input.seniority);
  addInsertField('department', input.department);
  addInsertField('enrichment_data', input.enrichment_data, true);
  addInsertField('source_api', input.source_api);

  const result = await query<Contact>(
    `INSERT INTO contacts (${fields.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function getContactsForCompany(companyId: string): Promise<Contact[]> {
  return queryMany<Contact>(
    `SELECT * FROM contacts
     WHERE company_id = $1
     ORDER BY seniority`,
    [companyId]
  );
}

export async function contactAlreadyMessaged(
  email?: string,
  linkedinUrl?: string
): Promise<boolean> {
  if (!email && !linkedinUrl) return false;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (email) {
    conditions.push(`email = $${paramIndex}`);
    values.push(email);
    paramIndex++;
  }

  if (linkedinUrl) {
    conditions.push(`linkedin_url = $${paramIndex}`);
    values.push(linkedinUrl);
  }

  const result = await queryOne<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM campaign_contacts cc
       JOIN contacts co ON cc.contact_id = co.id
       WHERE (${conditions.join(' OR ')})
         AND cc.status != 'pending'
     ) AS found`,
    values
  );

  return result?.found ?? false;
}
