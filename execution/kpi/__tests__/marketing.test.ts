import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client.js", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

import { queryOne, queryMany } from "../../db/client.js";
import { getMarketingKPIs } from "../marketing.js";

describe("getMarketingKPIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns volume and rate metrics for all_time", async () => {
    // queryVolume
    vi.mocked(queryOne).mockResolvedValueOnce({
      contacts_reached: 50,
      messages_sent: 100,
      messages_opened: 40,
      messages_replied: 10,
      positive_replies: 7,
      total_replies: 10,
    } as never);

    // queryByChannel
    vi.mocked(queryMany).mockResolvedValueOnce([
      { channel: "email", sent: 80, opened: 35, replied: 8 },
      { channel: "linkedin_connection", sent: 20, opened: 5, replied: 2 },
    ] as never);

    // queryByVariant
    vi.mocked(queryMany).mockResolvedValueOnce([
      { copy_variant: "A", sent: 50, opened: 20, replied: 5 },
      { copy_variant: "B", sent: 50, opened: 20, replied: 5 },
    ] as never);

    // queryBySignalType
    vi.mocked(queryMany).mockResolvedValueOnce([
      { signal_type: "hiring", contacts: 30, replied: 6, meetings: 2 },
      { signal_type: "funding", contacts: 20, replied: 4, meetings: 1 },
    ] as never);

    // queryBySequenceStep
    vi.mocked(queryMany).mockResolvedValueOnce([
      { sequence_step: 1, sent: 80, opened: 30, replied: 8 },
      { sequence_step: 2, sent: 20, opened: 10, replied: 2 },
    ] as never);

    // queryCosts
    vi.mocked(queryMany).mockResolvedValueOnce([
      { api_name: "exa", calls: 50, cost_usd: 25 },
      { api_name: "parallel", calls: 30, cost_usd: 15 },
    ] as never);

    const result = await getMarketingKPIs({ period: "all_time" });

    expect(result.period.preset).toBe("all_time");
    expect(result.previous).toBeNull();

    // Volume
    expect(result.current.volume.contacts_reached).toBe(50);
    expect(result.current.volume.messages_sent).toBe(100);
    expect(result.current.volume.messages_opened).toBe(40);
    expect(result.current.volume.messages_replied).toBe(10);

    // Rates
    expect(result.current.rates.open_rate).toBe(0.4);
    expect(result.current.rates.reply_rate).toBe(0.1);
    expect(result.current.rates.positive_sentiment_rate).toBe(0.7);

    // Channel breakdown
    expect(result.current.by_channel.email.sent).toBe(80);
    expect(result.current.by_channel.email.reply_rate).toBe(0.1);
    expect(result.current.by_channel.linkedin_connection.sent).toBe(20);

    // Variant breakdown
    expect(result.current.by_variant.A.sent).toBe(50);
    expect(result.current.by_variant.A.sample_size_sufficient).toBe(true);

    // Signal type breakdown
    expect(result.current.by_signal_type.hiring.contacts).toBe(30);
    expect(result.current.by_signal_type.hiring.reply_rate).toBe(0.2);

    // Costs
    expect(result.current.cost.total_usd).toBe(40);
    expect(result.current.cost.cost_per_reply).toBe(4); // 40 / 10
    expect(result.current.cost.cost_per_meeting).toBe(40 / 3); // 40 / 3 meetings
    expect(result.current.cost.by_api).toHaveLength(2);

    // Sequence step breakdown
    expect(result.current.by_sequence_step[1]!.sent).toBe(80);
    expect(result.current.by_sequence_step[2]!.reply_rate).toBe(0.1);
  });

  it("marks variants with < 30 sends as insufficient sample size", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      contacts_reached: 10, messages_sent: 20, messages_opened: 5,
      messages_replied: 2, positive_replies: 1, total_replies: 2,
    } as never);
    vi.mocked(queryMany)
      .mockResolvedValueOnce([] as never) // channels
      .mockResolvedValueOnce([
        { copy_variant: "A", sent: 15, opened: 5, replied: 1 },
      ] as never) // variants
      .mockResolvedValueOnce([] as never) // signal types
      .mockResolvedValueOnce([] as never) // sequence steps
      .mockResolvedValueOnce([] as never); // costs

    const result = await getMarketingKPIs({ period: "all_time" });
    expect(result.current.by_variant.A.sample_size_sufficient).toBe(false);
  });

  it("handles zero messages gracefully", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      contacts_reached: 0, messages_sent: 0, messages_opened: 0,
      messages_replied: 0, positive_replies: 0, total_replies: 0,
    } as never);
    vi.mocked(queryMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await getMarketingKPIs({ period: "all_time" });

    expect(result.current.rates.open_rate).toBe(0);
    expect(result.current.rates.reply_rate).toBe(0);
    expect(result.current.rates.positive_sentiment_rate).toBe(0);
    expect(result.current.cost.total_usd).toBe(0);
    expect(result.current.cost.cost_per_reply).toBe(0);
    expect(result.current.cost.cost_per_meeting).toBe(0);
  });

  it("passes campaignId filter to queries", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      contacts_reached: 0, messages_sent: 0, messages_opened: 0,
      messages_replied: 0, positive_replies: 0, total_replies: 0,
    } as never);
    vi.mocked(queryMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    await getMarketingKPIs({ period: "all_time", campaignId: "camp-123" });

    // Volume query should contain campaign filter
    const volumeSql = vi.mocked(queryOne).mock.calls[0]![0] as string;
    expect(volumeSql).toContain("cc.campaign_id = $");
    const volumeParams = vi.mocked(queryOne).mock.calls[0]![1] as unknown[];
    expect(volumeParams).toContain("camp-123");
  });

  it("includes period-over-period comparison for last_7d", async () => {
    const mockVolume = {
      contacts_reached: 10, messages_sent: 20, messages_opened: 8,
      messages_replied: 3, positive_replies: 2, total_replies: 3,
    };

    // Current period
    vi.mocked(queryOne).mockResolvedValueOnce(mockVolume as never);
    vi.mocked(queryMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    // Previous period
    vi.mocked(queryOne).mockResolvedValueOnce({
      ...mockVolume, messages_sent: 15, messages_replied: 1,
    } as never);
    vi.mocked(queryMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await getMarketingKPIs({ period: "last_7d" });

    expect(result.previous).not.toBeNull();
    expect(result.delta).not.toBeNull();
    expect(result.previous!.volume.messages_sent).toBe(15);
  });
});
