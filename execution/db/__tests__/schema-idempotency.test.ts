import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = path.resolve(process.cwd(), "execution/db/schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf-8");

describe("schema idempotency guards", () => {
  it("enables pgcrypto extension when missing", () => {
    expect(schemaSql).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  });

  it("drops and recreates update triggers safely", () => {
    expect(schemaSql).toContain("DROP TRIGGER IF EXISTS update_offers_updated_at ON offers;");
    expect(schemaSql).toContain("DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;");
    expect(schemaSql).toContain("DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;");
    expect(schemaSql).toContain("DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;");
  });

  it("creates signal routing audit table for accepted/skipped traceability", () => {
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS signal_routing_audit");
    expect(schemaSql).toContain("decision IN ('accepted', 'skipped')");
  });
});
