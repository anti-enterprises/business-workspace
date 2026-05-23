import type { PeriodInput, ResolvedPeriod, KPIResult } from "./types.js";

export function resolvePeriod(input: PeriodInput): ResolvedPeriod {
  const now = new Date();

  if (typeof input === "object" && "from" in input) {
    const durationMs = input.to.getTime() - input.from.getTime();
    return {
      current: { from: input.from, to: input.to },
      previous: {
        from: new Date(input.from.getTime() - durationMs),
        to: new Date(input.from.getTime()),
      },
      preset: "custom",
    };
  }

  switch (input) {
    case "last_7d": {
      const from = daysAgo(now, 7);
      return {
        current: { from, to: now },
        previous: { from: daysAgo(now, 14), to: from },
        preset: input,
      };
    }
    case "last_30d": {
      const from = daysAgo(now, 30);
      return {
        current: { from, to: now },
        previous: { from: daysAgo(now, 60), to: from },
        preset: input,
      };
    }
    case "last_90d": {
      const from = daysAgo(now, 90);
      return {
        current: { from, to: now },
        previous: { from: daysAgo(now, 180), to: from },
        preset: input,
      };
    }
    case "this_week": {
      const from = startOfWeekUTC(now);
      const prevFrom = new Date(from.getTime() - 7 * 86400000);
      return {
        current: { from, to: now },
        previous: { from: prevFrom, to: from },
        preset: input,
      };
    }
    case "this_month": {
      const from = startOfMonthUTC(now);
      const prevFrom = new Date(
        Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1),
      );
      return {
        current: { from, to: now },
        previous: { from: prevFrom, to: from },
        preset: input,
      };
    }
    case "this_quarter": {
      const from = startOfQuarterUTC(now);
      const prevFrom = new Date(
        Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 3, 1),
      );
      return {
        current: { from, to: now },
        previous: { from: prevFrom, to: from },
        preset: input,
      };
    }
    case "all_time":
      return {
        current: { from: new Date(0), to: now },
        previous: null,
        preset: input,
      };
  }
}

function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 86400000);
}

function startOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = start of week
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff),
  );
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfQuarterUTC(d: Date): Date {
  const quarterMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(d.getUTCFullYear(), quarterMonth, 1));
}

/** Fields that are rates/ratios — use percentage-point difference instead of % change */
const RATE_FIELDS = new Set([
  "open_rate",
  "reply_rate",
  "positive_sentiment_rate",
  "active_to_replied",
  "replied_to_meeting",
  "meeting_to_proposal",
  "proposal_to_negotiating",
  "negotiating_to_closed_won",
  "overall_win_rate",
]);

/**
 * Compute absolute and percentage deltas between current and previous metrics.
 * Rate fields get percentage-point difference (not percentage-of-percentage).
 */
export function computeDeltas<T extends object>(
  current: T,
  previous: T,
): { delta: Partial<T>; delta_pct: Partial<T> } {
  const delta = {} as Record<string, unknown>;
  const deltaPct = {} as Record<string, unknown>;
  const cur = current as Record<string, unknown>;
  const prev = previous as Record<string, unknown>;

  for (const key of Object.keys(cur)) {
    const curVal = cur[key];
    const prevVal = prev[key];

    if (typeof curVal === "number" && typeof prevVal === "number") {
      const diff = curVal - prevVal;
      delta[key] = diff;

      if (RATE_FIELDS.has(key)) {
        // Percentage-point difference for rates
        deltaPct[key] = diff;
      } else {
        deltaPct[key] = prevVal !== 0 ? diff / prevVal : curVal !== 0 ? 1 : 0;
      }
    } else if (
      typeof curVal === "object" &&
      curVal !== null &&
      typeof prevVal === "object" &&
      prevVal !== null &&
      !Array.isArray(curVal)
    ) {
      const nested = computeDeltas(
        curVal as Record<string, unknown>,
        prevVal as Record<string, unknown>,
      );
      delta[key] = nested.delta;
      deltaPct[key] = nested.delta_pct;
    }
  }

  return { delta: delta as Partial<T>, delta_pct: deltaPct as Partial<T> };
}

/**
 * Wrap metrics with period info and optional comparison deltas.
 */
export function wrapKPIResult<T extends object>(
  resolved: ResolvedPeriod,
  current: T,
  previous: T | null,
): KPIResult<T> {
  if (previous) {
    const { delta, delta_pct } = computeDeltas(current, previous);
    return {
      period: { from: resolved.current.from, to: resolved.current.to, preset: resolved.preset },
      current,
      previous,
      delta,
      delta_pct,
    };
  }

  return {
    period: { from: resolved.current.from, to: resolved.current.to, preset: resolved.preset },
    current,
    previous: null,
    delta: null,
    delta_pct: null,
  };
}
