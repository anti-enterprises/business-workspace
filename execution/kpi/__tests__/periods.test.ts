import { describe, expect, it } from "vitest";
import { resolvePeriod, computeDeltas } from "../periods.js";

describe("resolvePeriod", () => {
  it("resolves last_7d with a 7-day comparison window", () => {
    const result = resolvePeriod("last_7d");
    const durationMs = result.current.to.getTime() - result.current.from.getTime();
    const days = durationMs / 86400000;
    expect(days).toBeCloseTo(7, 0);
    expect(result.previous).not.toBeNull();

    const prevDurationMs =
      result.previous!.to.getTime() - result.previous!.from.getTime();
    expect(prevDurationMs).toBeCloseTo(durationMs, -2);
    expect(result.previous!.to.getTime()).toBe(result.current.from.getTime());
    expect(result.preset).toBe("last_7d");
  });

  it("resolves last_30d with a 30-day comparison window", () => {
    const result = resolvePeriod("last_30d");
    const days =
      (result.current.to.getTime() - result.current.from.getTime()) / 86400000;
    expect(days).toBeCloseTo(30, 0);
    expect(result.previous).not.toBeNull();
    expect(result.preset).toBe("last_30d");
  });

  it("resolves all_time with no previous period", () => {
    const result = resolvePeriod("all_time");
    expect(result.current.from.getTime()).toBe(0);
    expect(result.previous).toBeNull();
    expect(result.preset).toBe("all_time");
  });

  it("resolves custom date range with equal previous window", () => {
    const from = new Date("2026-03-01T00:00:00Z");
    const to = new Date("2026-03-15T00:00:00Z");
    const result = resolvePeriod({ from, to });

    expect(result.current.from).toEqual(from);
    expect(result.current.to).toEqual(to);
    expect(result.preset).toBe("custom");

    const duration = to.getTime() - from.getTime();
    expect(result.previous!.to.getTime()).toBe(from.getTime());
    expect(result.previous!.from.getTime()).toBe(from.getTime() - duration);
  });

  it("resolves this_week starting on Monday", () => {
    const result = resolvePeriod("this_week");
    expect(result.current.from.getUTCDay()).not.toBe(0); // Not Sunday
    // Monday = 1
    expect(result.current.from.getUTCDay()).toBe(1);
    expect(result.previous).not.toBeNull();
  });

  it("resolves this_month starting on the 1st", () => {
    const result = resolvePeriod("this_month");
    expect(result.current.from.getUTCDate()).toBe(1);
    expect(result.previous).not.toBeNull();
    expect(result.previous!.from.getUTCDate()).toBe(1);
  });

  it("resolves this_quarter starting on quarter boundary", () => {
    const result = resolvePeriod("this_quarter");
    const month = result.current.from.getUTCMonth();
    expect(month % 3).toBe(0);
    expect(result.current.from.getUTCDate()).toBe(1);
  });
});

describe("computeDeltas", () => {
  it("computes absolute and percentage deltas for numeric fields", () => {
    const current = { count: 20, total: 100 };
    const previous = { count: 10, total: 80 };
    const { delta, delta_pct } = computeDeltas(current, previous);

    expect(delta.count).toBe(10);
    expect(delta.total).toBe(20);
    expect(delta_pct.count).toBe(1); // 100% increase
    expect(delta_pct.total).toBe(0.25); // 25% increase
  });

  it("uses percentage-point difference for rate fields", () => {
    const current = { reply_rate: 0.15, open_rate: 0.40, count: 100 };
    const previous = { reply_rate: 0.10, open_rate: 0.30, count: 80 };
    const { delta, delta_pct } = computeDeltas(current, previous);

    // Rate fields: delta_pct = absolute difference (percentage points)
    expect(delta_pct.reply_rate).toBeCloseTo(0.05);
    expect(delta_pct.open_rate).toBeCloseTo(0.10);
    // Non-rate fields: delta_pct = relative percentage change
    expect(delta_pct.count).toBe(0.25);
  });

  it("handles zero previous values", () => {
    const current = { count: 10 };
    const previous = { count: 0 };
    const { delta, delta_pct } = computeDeltas(current, previous);

    expect(delta.count).toBe(10);
    expect(delta_pct.count).toBe(1); // Special case: 100%
  });

  it("handles both current and previous being zero", () => {
    const current = { count: 0 };
    const previous = { count: 0 };
    const { delta, delta_pct } = computeDeltas(current, previous);

    expect(delta.count).toBe(0);
    expect(delta_pct.count).toBe(0);
  });

  it("recursively handles nested objects", () => {
    const current = { funnel: { replied: 20, meeting_booked: 5 } };
    const previous = { funnel: { replied: 10, meeting_booked: 3 } };
    const { delta } = computeDeltas(current, previous);

    const funnelDelta = delta.funnel as Record<string, number>;
    expect(funnelDelta.replied).toBe(10);
    expect(funnelDelta.meeting_booked).toBe(2);
  });

  it("skips array and non-numeric fields", () => {
    const current = { items: [1, 2, 3], name: "test", count: 5 };
    const previous = { items: [1], name: "old", count: 3 };
    const { delta } = computeDeltas(current, previous);

    expect((delta as Record<string, unknown>).items).toBeUndefined();
    expect((delta as Record<string, unknown>).name).toBeUndefined();
    expect((delta as Record<string, unknown>).count).toBe(2);
  });
});
