import { logToolUsage } from "../db/tool-usage.js";

export interface RequestOptions {
  method?: "GET" | "POST";
  params?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  campaignId?: string;
}

export abstract class BaseApiClient {
  protected abstract readonly apiName: string;
  protected abstract readonly baseUrl: string;
  protected abstract readonly timeout: number;

  protected abstract getHeaders(): Record<string, string>;

  async request<T = Record<string, unknown>>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { method = "POST", params, body, campaignId } = options;
    const start = Date.now();

    let url = `${this.baseUrl}/${endpoint.replace(/^\//, "")}`;

    if (params && method === "GET") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        qs.set(k, String(v));
      }
      url += `?${qs.toString()}`;
    }

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
          `${this.apiName} API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
        await this.log(endpoint, params ?? body, 0, Date.now() - start, false, error.message, campaignId);
        throw error;
      }

      const data = (await response.json()) as T;
      const resultsCount = this.countResults(data);
      await this.log(endpoint, params ?? body, resultsCount, Date.now() - start, true, undefined, campaignId);
      return data;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith(`${this.apiName} API error`)) {
        throw err;
      }
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      await this.log(endpoint, params ?? body, 0, duration, false, message, campaignId);
      throw err;
    }
  }

  protected countResults(data: unknown): number {
    if (typeof data !== "object" || data === null) return 0;
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results.length;
    if (Array.isArray(obj.data)) return obj.data.length;
    return 0;
  }

  private async log(
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
