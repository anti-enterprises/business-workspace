import { z } from "zod/v4";

export const OfferStatus = z.enum(["active", "paused", "archived"]);
export type OfferStatus = z.infer<typeof OfferStatus>;

export const PositioningCanvas = z.object({
  category: z.string().optional(),
  target_customer: z.string().optional(),
  problem: z.string().optional(),
  signals: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
  alternatives: z.array(z.string()).optional(),
  pitch: z.string().optional(),
  differentiator: z.string().optional(),
});
export type PositioningCanvas = z.infer<typeof PositioningCanvas>;

export const CompanyProfile = z.object({
  industry: z.union([z.string(), z.array(z.string())]).optional(),
  industry_exclude: z.array(z.string()).optional(),
  employee_count_min: z.number().optional(),
  employee_count_max: z.number().optional(),
  revenue_range: z.string().optional(),
  geography: z.union([z.string(), z.array(z.string())]).optional(),
  stage: z.string().optional(),
  tech_stack_must_have: z.array(z.string()).optional(),
  tech_stack_complementary: z.array(z.string()).optional(),
  tech_stack_absence: z.array(z.string()).optional(),
});
export type CompanyProfile = z.infer<typeof CompanyProfile>;

export const BuyerProfile = z.object({
  titles: z.array(z.string()).optional(),
  seniority: z.array(z.string()).optional(),
  department: z.string().optional(),
  pain_points: z.array(z.string()).optional(),
});
export type BuyerProfile = z.infer<typeof BuyerProfile>;

export const ScoringRubric = z.object({
  firmographic: z.number().default(30),
  technographic: z.number().default(20),
  signal_strength: z.number().default(30),
  buyer_accessibility: z.number().default(20),
});
export type ScoringRubric = z.infer<typeof ScoringRubric>;

export const ICP = z.object({
  company_profile: CompanyProfile.optional(),
  buyer_profile: BuyerProfile.optional(),
  scoring_rubric: ScoringRubric.optional(),
  disqualifiers: z.array(z.string()).optional(),
});
export type ICP = z.infer<typeof ICP>;

export interface Offer {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  positioning: PositioningCanvas | null;
  icp: ICP | null;
  status: OfferStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateOfferInput {
  slug: string;
  name: string;
  description?: string;
  positioning?: PositioningCanvas;
  icp?: ICP;
}

export interface UpdateOfferInput {
  name?: string;
  description?: string;
  positioning?: PositioningCanvas;
  icp?: ICP;
  status?: OfferStatus;
}
