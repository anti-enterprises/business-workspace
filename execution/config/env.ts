import { z } from "zod/v4";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const EnvSchema = z.object({
  DATABASE_URL: z.string(),
  ANTHROPIC_API_KEY: z.string().optional(),
  PARALLEL_API_KEY: z.string().optional(),
  THEIRSTACK_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  LEADMAGIC_API_KEY: z.string().optional(),
  FULLENRICH_API_KEY: z.string().optional(),
  UNIPILE_API_KEY: z.string().optional(),
  UNIPILE_DSN: z.string().optional(),
  DUCKDNS_TOKEN: z.string().optional(),
  DUCKDNS_SUBDOMAIN: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  X_API_BEARER_TOKEN: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  APIFY_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}

export function hasApiKey(key: keyof Env): boolean {
  try {
    const env = getEnv();
    return !!env[key];
  } catch {
    return false;
  }
}
