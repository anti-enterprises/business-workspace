import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/campaigns.js", () => ({
  getCampaignById: vi.fn(),
}));

vi.mock("../../db/campaign-contacts.js", () => ({
  getCampaignContacts: vi.fn(),
  updateCampaignContact: vi.fn(),
}));

vi.mock("../../db/messages.js", () => ({
  createMessagesBatch: vi.fn(),
  updateMessage: vi.fn(),
  getQueuedMessagesForDispatch: vi.fn(),
}));

vi.mock("../../db/tool-usage.js", () => ({
  logActivity: vi.fn(),
  getDailySendCount: vi.fn(),
}));

vi.mock("../../apis/unipile.js", () => ({
  sendEmail: vi.fn(),
  sendLinkedInConnection: vi.fn(),
  sendLinkedInMessage: vi.fn(),
}));

import { getCampaignById } from "../../db/campaigns.js";
import {
  getCampaignContacts,
  updateCampaignContact,
} from "../../db/campaign-contacts.js";
import {
  createMessagesBatch,
  getQueuedMessagesForDispatch,
  updateMessage,
} from "../../db/messages.js";
import { getDailySendCount, logActivity } from "../../db/tool-usage.js";
import {
  sendEmail,
  sendLinkedInConnection,
  sendLinkedInMessage,
} from "../../apis/unipile.js";
import { prepareOutreach, sendQueuedMessages } from "../outreach-manager.js";

describe("outreach-manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues outreach and transitions campaign contacts to active", async () => {
    vi.mocked(getCampaignById).mockResolvedValue({
      id: "camp-1",
      copy_variants: {
        control: { subject: "Hello {{first_name}}", body: "Hi {{first_name}}" },
      },
    } as never);

    vi.mocked(getCampaignContacts).mockResolvedValue([
      {
        id: "cc-1",
        contacts: {
          first_name: "Ava",
          email: "ava@example.com",
          email_verified: true,
          linkedin_url: null,
          companies: { name: "Acme", signals_found: { hiring: "yes" } },
        },
      },
      {
        id: "cc-2",
        contacts: {
          first_name: "Ben",
          email: null,
          email_verified: false,
          linkedin_url: "https://linkedin.com/in/ben",
          companies: { name: "Beta", signals_found: null },
        },
      },
    ] as never);

    vi.mocked(createMessagesBatch).mockResolvedValue([] as never);
    vi.mocked(updateCampaignContact).mockResolvedValue({} as never);

    const result = await prepareOutreach({ campaignId: "camp-1", accountId: "acct-1" });

    expect(result.messages_prepared).toBe(2);
    expect(result.by_channel.email).toBe(1);
    expect(result.by_channel.linkedin_connection).toBe(1);

    expect(createMessagesBatch).toHaveBeenCalledTimes(1);
    expect(updateCampaignContact).toHaveBeenCalledWith("cc-1", { status: "active" });
    expect(updateCampaignContact).toHaveBeenCalledWith("cc-2", { status: "active" });
  });

  it("sends queued messages with resolved recipients and campaign id", async () => {
    vi.mocked(getQueuedMessagesForDispatch).mockResolvedValue([
      {
        id: "m-1",
        campaign_id: "camp-1",
        campaign_contact_id: "cc-1",
        channel: "email",
        contact_email: "ava@example.com",
        contact_linkedin_url: null,
        subject: "subj",
        body: "body",
      },
      {
        id: "m-2",
        campaign_id: "camp-1",
        campaign_contact_id: "cc-2",
        channel: "linkedin_connection",
        contact_email: null,
        contact_linkedin_url: "https://linkedin.com/in/ben",
        subject: null,
        body: "connect",
      },
    ] as never);

    vi.mocked(getDailySendCount).mockResolvedValue(0 as never);
    vi.mocked(sendEmail).mockResolvedValue({ id: "ext-email", status: "sent" } as never);
    vi.mocked(sendLinkedInConnection).mockResolvedValue({ id: "ext-linkedin", status: "sent" } as never);
    vi.mocked(updateMessage).mockResolvedValue({} as never);
    vi.mocked(updateCampaignContact).mockResolvedValue({} as never);
    vi.mocked(logActivity).mockResolvedValue({} as never);

    const result = await sendQueuedMessages("acct-1", 10);

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(sendEmail).toHaveBeenCalledWith({
      to: "ava@example.com",
      subject: "subj",
      body: "body",
      accountId: "acct-1",
      campaignId: "camp-1",
    });
    expect(sendLinkedInConnection).toHaveBeenCalledWith({
      profileUrl: "https://linkedin.com/in/ben",
      message: "connect",
      accountId: "acct-1",
      campaignId: "camp-1",
    });
    expect(sendLinkedInMessage).not.toHaveBeenCalled();
    expect(updateCampaignContact).not.toHaveBeenCalled();
  });

  it("fails queued messages when recipient data is missing", async () => {
    vi.mocked(getQueuedMessagesForDispatch).mockResolvedValue([
      {
        id: "m-1",
        campaign_id: "camp-1",
        campaign_contact_id: "cc-1",
        channel: "email",
        contact_email: null,
        contact_linkedin_url: null,
        subject: "subj",
        body: "body",
      },
    ] as never);

    vi.mocked(getDailySendCount).mockResolvedValue(0 as never);
    vi.mocked(updateMessage).mockResolvedValue({} as never);

    const result = await sendQueuedMessages("acct-1", 10);

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updateMessage).toHaveBeenCalledWith("m-1", {
      status: "failed",
      error: "Missing recipient email for queued email message",
    });
  });
});
