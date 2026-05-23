import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client.js", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

vi.mock("../campaign-contacts.js", () => ({
  reconcileCampaignContactFromMessageEvent: vi.fn(),
}));

import { queryOne } from "../client.js";
import { reconcileCampaignContactFromMessageEvent } from "../campaign-contacts.js";
import { updateMessage } from "../messages.js";

describe("updateMessage lifecycle integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconciles campaign contact lifecycle when status is updated", async () => {
    vi.mocked(queryOne).mockResolvedValue({
      id: "m-1",
      campaign_contact_id: "cc-1",
      status: "sent",
    } as never);
    vi.mocked(reconcileCampaignContactFromMessageEvent).mockResolvedValue(
      null as never,
    );

    await updateMessage("m-1", {
      status: "sent",
      sent_at: "2026-02-01T10:00:00.000Z",
    });

    expect(reconcileCampaignContactFromMessageEvent).toHaveBeenCalledWith(
      "cc-1",
      "sent",
      "2026-02-01T10:00:00.000Z",
    );
  });

  it("does not reconcile lifecycle when status is not part of the update payload", async () => {
    vi.mocked(queryOne).mockResolvedValue({
      id: "m-1",
      campaign_contact_id: "cc-1",
      error: "x",
    } as never);

    await updateMessage("m-1", {
      error: "provider timeout",
    });

    expect(reconcileCampaignContactFromMessageEvent).not.toHaveBeenCalled();
  });
});
