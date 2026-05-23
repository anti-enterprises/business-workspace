import { getEnv } from "../config/env.js";
import { logToolUsage } from "../db/tool-usage.js";
import { BaseApiClient, type RequestOptions } from "./base-client.js";

class ApifyClient extends BaseApiClient {
  protected readonly apiName = "apify";
  protected readonly baseUrl = "https://api.apify.com/v2";
  protected readonly timeout = 300000; // 5 min — actors can take a while

  protected getHeaders() {
    return { "Content-Type": "application/json" };
  }

  /**
   * Override to append token as query param on POST requests.
   * Apify uses query auth (not header auth) and the base only appends
   * params on GET, so we re-implement fetch + logging here.
   */
  async request<T = Record<string, unknown>>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const token = getEnv().APIFY_API_TOKEN;
    if (!token) throw new Error("APIFY_API_TOKEN not set");

    const { method = "POST", body, campaignId } = options;
    const start = Date.now();

    const url = `${this.baseUrl}/${endpoint.replace(/^\//, "")}?token=${encodeURIComponent(token)}`;

    const fetchOptions: RequestInit = {
      method,
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    };

    if (body && method === "POST") {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const error = new Error(
          `apify API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
        await this.logUsage(endpoint, body, 0, Date.now() - start, false, error.message, campaignId);
        throw error;
      }

      const data = (await response.json()) as T;
      const resultsCount = this.countResults(data);
      await this.logUsage(endpoint, body, resultsCount, Date.now() - start, true, undefined, campaignId);
      return data;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("apify API error")) {
        throw err;
      }
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      await this.logUsage(endpoint, body, 0, duration, false, message, campaignId);
      throw err;
    }
  }

  protected countResults(data: unknown): number {
    if (Array.isArray(data)) return data.length;
    return super.countResults(data);
  }

  private async logUsage(
    operation: string,
    requestParams: unknown,
    resultsCount: number,
    durationMs: number,
    success: boolean,
    error?: string,
    campaignId?: string,
  ): Promise<void> {
    try {
      await logToolUsage({
        api_name: this.apiName,
        operation,
        campaign_id: campaignId,
        request_params: requestParams as Record<string, unknown> | undefined,
        results_count: resultsCount,
        duration_ms: durationMs,
        success,
        error,
      });
    } catch {
      // Don't fail API call if logging fails
    }
  }
}

const client = new ApifyClient();

/**
 * Run an Apify actor synchronously and return the dataset items.
 *
 * Calls POST /acts/{actorId}/run-sync-get-dataset-items with the input as body.
 * The response is the dataset items array directly.
 */
export async function runActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
): Promise<T[]> {
  return client.request<T[]>(
    `acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`,
    { method: "POST", body: input },
  );
}
