export interface Review {
  id: string;
  platform: "g2" | "capterra" | "trustradius";
  review_id: string;
  product_name: string;
  product_slug?: string;
  title?: string;
  body?: string;
  pros?: string;
  cons?: string;
  rating?: number;
  rating_original?: number;
  rating_scale?: string;
  review_date?: string;
  review_url?: string;
  reviewer_name?: string;
  reviewer_job_title?: string;
  reviewer_company?: string;
  reviewer_company_size?: string;
  reviewer_industry?: string;
  verified?: boolean;
  incentivized?: boolean;
  recommend_score?: number;
  platform_data?: Record<string, unknown>;
  raw_json: Record<string, unknown>;
  scraped_at?: string;
}

export type UpsertReviewInput = Omit<Review, "id" | "scraped_at">;

// --- Normalizers ---

/**
 * Normalize raw G2 Real-Time Reviews Scraper output to UpsertReviewInput.
 */
export function normalizeG2Review(raw: Record<string, unknown>): UpsertReviewInput {
  const text = (raw.text as string) ?? undefined;
  let pros: string | undefined;
  let cons: string | undefined;

  if (text && text.includes(" | ")) {
    const parts = text.split(" | ");
    pros = parts[0]?.trim();
    cons = parts[1]?.trim();
  }

  const reviewerInfo = raw.reviewerInfo as string[] | undefined;

  return {
    platform: "g2",
    review_id: String(raw.reviewId ?? ""),
    product_name: String(raw.productName ?? ""),
    product_slug: raw.productSlug != null ? String(raw.productSlug) : undefined,
    title: raw.title != null ? String(raw.title) : undefined,
    body: text,
    pros,
    cons,
    rating: raw.starRating != null ? Number(raw.starRating) : undefined,
    review_date: raw.date != null ? String(raw.date) : undefined,
    reviewer_name: raw.reviewerName != null ? String(raw.reviewerName) : undefined,
    reviewer_job_title: raw.reviewerTitle != null ? String(raw.reviewerTitle) : undefined,
    reviewer_company_size: reviewerInfo?.[0] ?? undefined,
    verified: raw.validatedReviewer != null ? Boolean(raw.validatedReviewer) : undefined,
    incentivized: raw.incentivized != null ? Boolean(raw.incentivized) : undefined,
    platform_data: {
      markdownContent: raw.markdownContent,
      validatedMethod: raw.validatedMethod,
      reviewSource: raw.reviewSource,
      verifiedCurrentUser: raw.verifiedCurrentUser,
    },
    raw_json: raw,
  };
}

/**
 * Normalize raw All-In-One Review Scraper output to UpsertReviewInput.
 * Works for TrustRadius and other platforms the actor supports.
 */
export function normalizeAllInOneReview(raw: Record<string, unknown>): UpsertReviewInput {
  const reviewer = raw.reviewer as Record<string, unknown> | undefined;
  const ratingScale = raw.ratingScale != null ? String(raw.ratingScale) : undefined;

  let rating: number | undefined;
  if (raw.rating != null) {
    const rawRating = Number(raw.rating);
    if (ratingScale === "1-10") {
      rating = rawRating / 2;
    } else {
      // "1-5" or anything else — use as-is
      rating = rawRating;
    }
  }

  return {
    platform: ((raw.platform as string) || "trustradius") as Review["platform"],
    review_id: String(raw.reviewId ?? ""),
    product_name: String(raw.productName ?? ""),
    title: raw.title != null ? String(raw.title) : undefined,
    body: raw.text != null ? String(raw.text) : undefined,
    pros: raw.pros != null ? String(raw.pros) : undefined,
    cons: raw.cons != null ? String(raw.cons) : undefined,
    rating,
    rating_original: raw.ratingOriginal != null ? Number(raw.ratingOriginal) : undefined,
    rating_scale: ratingScale,
    review_date: raw.date != null ? String(raw.date) : undefined,
    review_url: raw.reviewUrl != null ? String(raw.reviewUrl) : undefined,
    reviewer_name: reviewer?.name != null ? String(reviewer.name) : undefined,
    reviewer_job_title: reviewer?.jobTitle != null ? String(reviewer.jobTitle) : undefined,
    reviewer_company: reviewer?.company != null ? String(reviewer.company) : undefined,
    reviewer_company_size: reviewer?.companySize != null ? String(reviewer.companySize) : undefined,
    reviewer_industry: reviewer?.industry != null ? String(reviewer.industry) : undefined,
    verified: reviewer?.verified != null ? Boolean(reviewer.verified) : undefined,
    incentivized: raw.incentivized != null ? !!raw.incentivized : undefined,
    recommend_score: raw.recommendationScore != null ? Number(raw.recommendationScore) : undefined,
    platform_data: (raw.platformData as Record<string, unknown>) ?? undefined,
    raw_json: raw,
  };
}

/**
 * Parse a human-readable date like "March 23, 2026" to ISO date string "2026-03-23".
 * Returns the original string if parsing fails.
 */
function parseCapterraDate(dateStr: string): string {
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return dateStr;
  return parsed.toISOString().split("T")[0];
}

/**
 * Extract product name from a Capterra product URL slug.
 * e.g. "/p/123456/ProductName/" -> "ProductName"
 */
function extractCapterraProductName(url: string): string {
  const match = url.match(/\/p\/\d+\/([^/]+)/);
  return match?.[1]?.replace(/-/g, " ") ?? "";
}

/**
 * Normalize raw Capterra Reviews Scraper output to UpsertReviewInput.
 */
export function normalizeCapterraReview(raw: Record<string, unknown>): UpsertReviewInput {
  const productUrl = raw.productUrl != null ? String(raw.productUrl) : "";

  return {
    platform: "capterra",
    review_id: String(raw.id ?? ""),
    product_name: productUrl ? extractCapterraProductName(productUrl) : "",
    title: raw.title != null ? String(raw.title) : undefined,
    body: raw.comments != null ? String(raw.comments) : undefined,
    pros: raw.pros != null ? String(raw.pros) : undefined,
    cons: raw.cons != null ? String(raw.cons) : undefined,
    rating: raw.rating != null ? Number(raw.rating) : undefined,
    review_date: raw.date != null ? parseCapterraDate(String(raw.date)) : undefined,
    review_url: raw.reviewUrl != null ? String(raw.reviewUrl) : undefined,
    reviewer_name: raw.author != null ? String(raw.author) : undefined,
    reviewer_job_title: raw.jobTitle != null ? String(raw.jobTitle) : undefined,
    reviewer_company_size: raw.companySize != null ? String(raw.companySize) : undefined,
    reviewer_industry: raw.industry != null ? String(raw.industry) : undefined,
    incentivized: raw.incentivized != null ? raw.incentivized !== "NoIncentive" : undefined,
    recommend_score: raw.recommendRating != null ? Number(raw.recommendRating) : undefined,
    platform_data: {
      supportRating: raw.supportRating,
      easeRating: raw.easeRating,
      funcRating: raw.funcRating,
      valueRating: raw.valueRating,
      timeUsed: raw.timeUsed,
      switchingReasons: raw.switchingReasons,
      chosenReasons: raw.chosenReasons,
      response: raw.response,
      reviewSource: raw.reviewSource,
    },
    raw_json: raw,
  };
}
