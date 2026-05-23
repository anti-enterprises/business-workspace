import { query, queryMany } from "./client.js";
import type { Review, UpsertReviewInput } from "../types/review.js";

interface InsertField<T> {
  column: string;
  read: (input: T) => unknown;
  json?: boolean;
}

const REVIEW_INSERT_FIELDS: InsertField<UpsertReviewInput>[] = [
  { column: "platform", read: (input) => input.platform },
  { column: "review_id", read: (input) => input.review_id },
  { column: "product_name", read: (input) => input.product_name },
  { column: "product_slug", read: (input) => input.product_slug },
  { column: "title", read: (input) => input.title },
  { column: "body", read: (input) => input.body },
  { column: "pros", read: (input) => input.pros },
  { column: "cons", read: (input) => input.cons },
  { column: "rating", read: (input) => input.rating },
  { column: "rating_original", read: (input) => input.rating_original },
  { column: "rating_scale", read: (input) => input.rating_scale },
  { column: "review_date", read: (input) => input.review_date },
  { column: "review_url", read: (input) => input.review_url },
  { column: "reviewer_name", read: (input) => input.reviewer_name },
  { column: "reviewer_job_title", read: (input) => input.reviewer_job_title },
  { column: "reviewer_company", read: (input) => input.reviewer_company },
  { column: "reviewer_company_size", read: (input) => input.reviewer_company_size },
  { column: "reviewer_industry", read: (input) => input.reviewer_industry },
  { column: "verified", read: (input) => input.verified },
  { column: "incentivized", read: (input) => input.incentivized },
  { column: "recommend_score", read: (input) => input.recommend_score },
  { column: "platform_data", read: (input) => input.platform_data, json: true },
  { column: "raw_json", read: (input) => input.raw_json, json: true },
];

function buildInsert<T>(
  input: T,
  fields: InsertField<T>[],
): { columns: string[]; placeholders: string[]; values: unknown[] } {
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const field of fields) {
    const rawValue = field.read(input);
    if (rawValue === undefined) continue;

    columns.push(field.column);
    placeholders.push(`$${paramIndex}`);
    values.push(field.json ? JSON.stringify(rawValue) : rawValue);
    paramIndex++;
  }

  return { columns, placeholders, values };
}

export async function upsertReview(input: UpsertReviewInput): Promise<Review> {
  const { columns, placeholders, values } = buildInsert(input, REVIEW_INSERT_FIELDS);

  const updateClauses = columns
    .filter((col) => col !== "platform" && col !== "review_id")
    .map((col) => `${col} = EXCLUDED.${col}`);

  const result = await query<Review>(
    `INSERT INTO reviews (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})
     ON CONFLICT (platform, review_id) DO UPDATE SET
       ${updateClauses.join(",\n       ")},
       scraped_at = now()
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function upsertReviews(
  inputs: UpsertReviewInput[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const input of inputs) {
    const { columns, placeholders, values } = buildInsert(input, REVIEW_INSERT_FIELDS);

    const updateClauses = columns
      .filter((col) => col !== "platform" && col !== "review_id")
      .map((col) => `${col} = EXCLUDED.${col}`);

    const result = await query<{ is_insert: boolean }>(
      `INSERT INTO reviews (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       ON CONFLICT (platform, review_id) DO UPDATE SET
         ${updateClauses.join(",\n         ")},
         scraped_at = now()
       RETURNING (xmax = 0) AS is_insert`,
      values,
    );

    if (result.rows[0].is_insert) {
      inserted++;
    } else {
      updated++;
    }
  }

  return { inserted, updated };
}

export async function getReviewsByProduct(
  productName: string,
  limit = 100,
): Promise<Review[]> {
  return queryMany<Review>(
    `SELECT * FROM reviews
     WHERE product_name = $1
     ORDER BY review_date DESC
     LIMIT $2`,
    [productName, limit],
  );
}

export async function getReviewsByPlatform(
  platform: string,
  limit = 100,
): Promise<Review[]> {
  return queryMany<Review>(
    `SELECT * FROM reviews
     WHERE platform = $1
     ORDER BY review_date DESC
     LIMIT $2`,
    [platform, limit],
  );
}

export async function getReviewStats(): Promise<
  { platform: string; product_count: number; review_count: number; avg_rating: number }[]
> {
  return queryMany(
    `SELECT
       platform,
       COUNT(DISTINCT product_name)::int AS product_count,
       COUNT(*)::int AS review_count,
       COALESCE(ROUND(AVG(rating), 2), 0)::numeric AS avg_rating
     FROM reviews
     GROUP BY platform
     ORDER BY platform`,
  );
}
