import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client.js", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

import { queryOne } from "../../db/client.js";
import { getSalesPipelineKPIs } from "../sales.js";

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  pending: 10,
  active: 8,
  replied: 5,
  meeting_booked: 3,
  proposal_sent: 2,
  negotiating: 1,
  closed_won: 1,
  closed_lost: 1,
  total_open_value: 15000,
  total_closed_won_value: 5000,
  deals_with_value: 1,
  total_deal_value_sum: 5000,
  avg_days_to_reply: 2.5,
  avg_days_to_meeting: 7.0,
  avg_days_to_close: 21.0,
  ...overrides,
});

describe("getSalesPipelineKPIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns funnel counts and conversion rates for all_time", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(makeRow() as never);

    const result = await getSalesPipelineKPIs({ period: "all_time" });

    expect(result.period.preset).toBe("all_time");
    expect(result.previous).toBeNull();
    expect(result.delta).toBeNull();

    expect(result.current.funnel.pending).toBe(10);
    expect(result.current.funnel.replied).toBe(5);
    expect(result.current.funnel.closed_won).toBe(1);

    // Conversion rates should be between 0 and 1
    expect(result.current.conversion_rates.active_to_replied).toBeGreaterThan(0);
    expect(result.current.conversion_rates.active_to_replied).toBeLessThanOrEqual(1);
    expect(result.current.conversion_rates.overall_win_rate).toBe(0.5); // 1 won / (1 won + 1 lost)
  });

  it("returns velocity metrics", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(makeRow() as never);

    const result = await getSalesPipelineKPIs({ period: "all_time" });

    expect(result.current.velocity.avg_days_to_reply).toBe(2.5);
    expect(result.current.velocity.avg_days_to_meeting).toBe(7.0);
    expect(result.current.velocity.avg_days_to_close).toBe(21.0);
  });

  it("returns pipeline value metrics", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(makeRow() as never);

    const result = await getSalesPipelineKPIs({ period: "all_time" });

    expect(result.current.pipeline_value.total_open).toBe(15000);
    expect(result.current.pipeline_value.total_closed_won).toBe(5000);
    expect(result.current.pipeline_value.avg_deal_size).toBe(5000);
  });

  it("handles null velocity when no data", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(
      makeRow({
        avg_days_to_reply: null,
        avg_days_to_meeting: null,
        avg_days_to_close: null,
      }) as never,
    );

    const result = await getSalesPipelineKPIs({ period: "all_time" });

    expect(result.current.velocity.avg_days_to_reply).toBeNull();
    expect(result.current.velocity.avg_days_to_meeting).toBeNull();
    expect(result.current.velocity.avg_days_to_close).toBeNull();
  });

  it("handles empty funnel", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(
      makeRow({
        pending: 0, active: 0, replied: 0, meeting_booked: 0,
        proposal_sent: 0, negotiating: 0, closed_won: 0, closed_lost: 0,
        total_open_value: 0, total_closed_won_value: 0,
        deals_with_value: 0, total_deal_value_sum: 0,
      }) as never,
    );

    const result = await getSalesPipelineKPIs({ period: "all_time" });

    expect(result.current.conversion_rates.active_to_replied).toBe(0);
    expect(result.current.conversion_rates.overall_win_rate).toBe(0);
    expect(result.current.pipeline_value.avg_deal_size).toBeNull();
  });

  it("includes period-over-period comparison for last_30d", async () => {
    const currentRow = makeRow();
    const previousRow = makeRow({
      replied: 3, meeting_booked: 1, closed_won: 0, closed_lost: 0,
      total_closed_won_value: 0,
    });

    vi.mocked(queryOne)
      .mockResolvedValueOnce(currentRow as never)
      .mockResolvedValueOnce(previousRow as never);

    const result = await getSalesPipelineKPIs({ period: "last_30d" });

    expect(result.previous).not.toBeNull();
    expect(result.delta).not.toBeNull();
    expect(result.delta_pct).not.toBeNull();

    const funnelDelta = result.delta!.funnel as Record<string, number>;
    expect(funnelDelta.replied).toBe(2); // 5 - 3
    expect(funnelDelta.meeting_booked).toBe(2); // 3 - 1
  });

  it("passes campaignId filter to query", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(makeRow() as never);

    await getSalesPipelineKPIs({ period: "all_time", campaignId: "camp-123" });

    const sql = vi.mocked(queryOne).mock.calls[0]![0] as string;
    const params = vi.mocked(queryOne).mock.calls[0]![1] as unknown[];
    expect(sql).toContain("cc.campaign_id = $");
    expect(params).toContain("camp-123");
  });
});
