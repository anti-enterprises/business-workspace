import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client.js", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

import { queryOne } from "../client.js";
import { reconcileCampaignContactFromMessageEvent } from "../campaign-contacts.js";

const baseCampaignContact = {
  id: "cc-1",
  campaign_id: "camp-1",
  contact_id: "contact-1",
  sequence_step: 1,
  status: "pending",
  added_at: "2026-01-01T00:00:00.000Z",
  last_contacted_at: null,
} as const;

describe("campaign-contact lifecycle reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves to active and sets last_contacted_at on successful send events", async () => {
    const sentAt = "2026-02-01T10:00:00.000Z";
    vi.mocked(queryOne)
      .mockResolvedValueOnce(baseCampaignContact as never)
      .mockResolvedValueOnce({
        total_messages: 1,
        replied_count: 0,
        bounced_count: 0,
        in_flight_count: 1,
      } as never)
      .mockResolvedValueOnce({
        ...baseCampaignContact,
        status: "active",
        last_contacted_at: sentAt,
      } as never);

    const result = await reconcileCampaignContactFromMessageEvent(
      "cc-1",
      "sent",
      sentAt,
    );

    expect(result?.status).toBe("active");
    expect(result?.last_contacted_at).toBe(sentAt);
    const updateSql = vi.mocked(queryOne).mock.calls[2]?.[0] as string;
    expect(updateSql).toContain("UPDATE campaign_contacts SET");
  });

  it("moves to replied when any message has replied status", async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...baseCampaignContact, status: "active" } as never)
      .mockResolvedValueOnce({
        total_messages: 2,
        replied_count: 1,
        bounced_count: 0,
        in_flight_count: 0,
      } as never)
      .mockResolvedValueOnce({
        ...baseCampaignContact,
        status: "replied",
      } as never);

    const result = await reconcileCampaignContactFromMessageEvent(
      "cc-1",
      "replied",
      "2026-02-01T11:00:00.000Z",
    );

    expect(result?.status).toBe("replied");
  });

  it("moves to completed when no in-flight, replied, or bounced messages remain", async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...baseCampaignContact, status: "active" } as never)
      .mockResolvedValueOnce({
        total_messages: 2,
        replied_count: 0,
        bounced_count: 0,
        in_flight_count: 0,
      } as never)
      .mockResolvedValueOnce({
        ...baseCampaignContact,
        status: "completed",
      } as never);

    const result = await reconcileCampaignContactFromMessageEvent("cc-1", "failed");
    expect(result?.status).toBe("completed");
  });

  it("does not override locked terminal statuses", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      ...baseCampaignContact,
      status: "opted_out",
    } as never);

    const result = await reconcileCampaignContactFromMessageEvent("cc-1", "sent");
    expect(result?.status).toBe("opted_out");
    expect(vi.mocked(queryOne)).toHaveBeenCalledTimes(1);
  });
});
