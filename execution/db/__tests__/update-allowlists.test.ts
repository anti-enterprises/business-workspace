import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client.js", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

import { query, queryOne } from "../client.js";
import { updateOffer } from "../offers.js";
import { updateCampaign } from "../campaigns.js";
import { createMessage, updateMessage } from "../messages.js";
import { updateCampaignContact } from "../campaign-contacts.js";
import { contactAlreadyMessaged, upsertContact } from "../contacts.js";
import { logActivity, logToolUsage } from "../tool-usage.js";

describe("db update allowlists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allowlists offer update columns", async () => {
    vi.mocked(queryOne).mockResolvedValue({} as never);
    await updateOffer("offer-1", { name: "Renamed", bad_field: "x" } as never);
    const sql = vi.mocked(queryOne).mock.calls[0]?.[0] as string;
    expect(sql).toContain("name = $1");
    expect(sql).not.toContain("bad_field");
  });

  it("allowlists campaign update columns", async () => {
    vi.mocked(queryOne).mockResolvedValue({} as never);
    await updateCampaign("camp-1", { status: "active", injected: "x" } as never);
    const sql = vi.mocked(queryOne).mock.calls[0]?.[0] as string;
    expect(sql).toContain("status = $1");
    expect(sql).not.toContain("injected");
  });

  it("allowlists message update columns", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as never);
    await updateMessage("msg-1", { status: "sent", attacker_controlled: "x" } as never);
    const sql = vi.mocked(queryOne).mock.calls[0]?.[0] as string;
    expect(sql).toContain("status = $1");
    expect(sql).not.toContain("attacker_controlled");
  });

  it("allowlists message insert columns", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{}] } as never);
    await createMessage({
      campaign_contact_id: "cc-1",
      channel: "email",
      body: "Hello",
      status: "queued",
      malicious_insert_col: "x",
    } as never);

    const sql = vi.mocked(query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("campaign_contact_id");
    expect(sql).toContain("channel");
    expect(sql).not.toContain("malicious_insert_col");
  });

  it("allowlists campaign-contact update columns", async () => {
    vi.mocked(queryOne).mockResolvedValue({} as never);
    await updateCampaignContact("cc-1", { status: "active", unknown: "x" } as never);
    const sql = vi.mocked(queryOne).mock.calls[0]?.[0] as string;
    expect(sql).toContain("status = $1");
    expect(sql).not.toContain("unknown");
  });

  it("allowlists contact upsert update columns", async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: "contact-1" } as never)
      .mockResolvedValueOnce({ id: "contact-1" } as never);

    await upsertContact({
      company_id: "company-1",
      email: "ava@example.com",
      first_name: "Ava",
      unknown_field: "x",
    } as never);

    const updateSql = vi.mocked(queryOne).mock.calls[1]?.[0] as string;
    expect(updateSql).toContain("first_name =");
    expect(updateSql).toContain("email =");
    expect(updateSql).not.toContain("unknown_field");
  });

  it("allowlists tool usage insert columns", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{}] } as never);
    await logToolUsage({
      api_name: "exa",
      operation: "search",
      campaign_id: "camp-1",
      attack_column: "x",
    } as never);

    const sql = vi.mocked(query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("api_name");
    expect(sql).toContain("operation");
    expect(sql).not.toContain("attack_column");
  });

  it("allowlists account activity insert columns", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{}] } as never);
    await logActivity({
      channel: "email",
      action: "send",
      account_id: "acct-1",
      injected: "x",
    } as never);

    const sql = vi.mocked(query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("account_activity");
    expect(sql).toContain("channel");
    expect(sql).not.toContain("injected");
  });
});

describe("contact dedupe query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedupe excludes pending contacts", async () => {
    vi.mocked(queryOne).mockResolvedValue({ found: true } as never);
    await contactAlreadyMessaged("ava@example.com");
    const sql = vi.mocked(queryOne).mock.calls[0]?.[0] as string;
    expect(sql).toContain("cc.status != 'pending'");
  });
});
