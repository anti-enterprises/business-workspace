import { describe, expect, it } from "vitest";
import type { NormalizedSearchResult } from "../../apis/exa.js";
import { resolveQualifiedExaCompanyDomain } from "../signal-router.js";

const baseNormalized: NormalizedSearchResult = {
  title: "Acme raised Series A",
  url: "https://techcrunch.com/2026/01/01/acme-series-a/",
  domain: "techcrunch.com",
  published_date: "2026-01-01",
  text: "",
  highlights: [],
  summary: "",
  score: 0.9,
};

describe("resolveQualifiedExaCompanyDomain", () => {
  it("accepts explicit company domain metadata", () => {
    const result = resolveQualifiedExaCompanyDomain(
      { company_domain: "acme.com" },
      baseNormalized,
    );
    expect(result.domain).toBe("acme.com");
    expect(result.source).toBe("metadata");
  });

  it("skips when company domain metadata is missing", () => {
    const result = resolveQualifiedExaCompanyDomain({}, baseNormalized);
    expect(result.domain).toBeNull();
    expect(result.reason).toBe("missing_company_domain_metadata");
  });

  it("skips publisher/aggregator metadata domains", () => {
    const result = resolveQualifiedExaCompanyDomain(
      { company_domain: "techcrunch.com" },
      baseNormalized,
    );
    expect(result.domain).toBeNull();
    expect(result.reason).toBe("publisher_or_aggregator_domain");
  });
});
