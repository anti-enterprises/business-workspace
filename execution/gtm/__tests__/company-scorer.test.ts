import { describe, it, expect } from "vitest";
import { scoreCompany, checkDisqualifiers } from "../company-scorer.js";
import type { ICP } from "../../types/offer.js";
import type { UpsertCompanyInput, SignalData } from "../../types/company.js";

const baseICP: ICP = {
  company_profile: {
    industry: ["SaaS", "Technology"],
    employee_count_min: 50,
    employee_count_max: 500,
    geography: ["United States", "Canada"],
    tech_stack_must_have: ["Salesforce"],
    tech_stack_complementary: ["HubSpot", "Outreach"],
    tech_stack_absence: ["CompetitorCRM"],
  },
  scoring_rubric: {
    firmographic: 30,
    technographic: 20,
    signal_strength: 30,
    buyer_accessibility: 20,
  },
  disqualifiers: [
    "employee_count < 10",
    "employee_count > 10000",
  ],
};

function makeCompany(overrides: Partial<UpsertCompanyInput & { signals_found?: SignalData }> = {}): UpsertCompanyInput & { signals_found?: SignalData } {
  return {
    name: "Test Corp",
    domain: "test.com",
    industry: "SaaS",
    employee_count: 200,
    country: "United States",
    tech_stack: ["Salesforce", "HubSpot"],
    signals_found: { signal_type: "hiring", signal_strength: "strong" },
    ...overrides,
  };
}

describe("scoreCompany", () => {
  it("scores a perfect-fit company high", () => {
    const result = scoreCompany(makeCompany(), baseICP);
    expect(result.score).toBeGreaterThan(50);
    expect(result.notes).toContain("Industry match");
    expect(result.notes).toContain("Employee count in range");
    expect(result.notes).toContain("Must-have tech found");
    expect(result.notes).toContain("Strong signal");
  });

  it("scores 0 for empty company with no ICP", () => {
    const result = scoreCompany({ name: "Empty", domain: "empty.com" }, {});
    expect(result.score).toBe(0);
  });

  it("gives partial credit for near-range employee count", () => {
    const company = makeCompany({ employee_count: 30 }); // below 50 min but above 25 (50*0.5)
    const result = scoreCompany(company, baseICP);
    expect(result.notes).toContain("Employee count near range");
  });

  it("gives no employee credit for way out of range", () => {
    const company = makeCompany({ employee_count: 5 }); // below 25 (50*0.5)
    const result = scoreCompany(company, baseICP);
    expect(result.notes).not.toContain("Employee count in range");
    expect(result.notes).not.toContain("Employee count near range");
  });

  it("matches geography", () => {
    const result = scoreCompany(makeCompany({ country: "Canada" }), baseICP);
    expect(result.notes).toContain("Geography match");
  });

  it("does not match wrong geography", () => {
    const result = scoreCompany(makeCompany({ country: "Germany" }), baseICP);
    expect(result.notes).not.toContain("Geography match");
  });

  it("gives greenfield tech bonus when competing tech absent", () => {
    const company = makeCompany({ tech_stack: ["Salesforce"] });
    const result = scoreCompany(company, baseICP);
    expect(result.notes).toContain("Greenfield opportunity (no competing tech)");
  });

  it("does not give greenfield bonus when competitor tech present", () => {
    const company = makeCompany({ tech_stack: ["Salesforce", "CompetitorCRM"] });
    const result = scoreCompany(company, baseICP);
    expect(result.notes).not.toContain("Greenfield opportunity (no competing tech)");
  });

  it("handles different signal strengths", () => {
    const moderate = scoreCompany(makeCompany({ signals_found: { signal_strength: "moderate" } }), baseICP);
    const weak = scoreCompany(makeCompany({ signals_found: { signal_strength: "weak" } }), baseICP);
    const strong = scoreCompany(makeCompany({ signals_found: { signal_strength: "strong" } }), baseICP);
    expect(strong.score).toBeGreaterThan(moderate.score);
    expect(moderate.score).toBeGreaterThan(weak.score);
  });

  it("gives base signal points for unrated signal", () => {
    const company = makeCompany({ signals_found: { signal_type: "hiring" } });
    const result = scoreCompany(company, baseICP);
    expect(result.notes).toContain("Signal present (unrated)");
  });

  it("caps score at 100", () => {
    const result = scoreCompany(makeCompany(), baseICP);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("handles string industry in ICP", () => {
    const icp: ICP = {
      company_profile: { industry: "SaaS" },
    };
    const result = scoreCompany(makeCompany(), icp);
    expect(result.notes).toContain("Industry match");
  });
});

describe("checkDisqualifiers", () => {
  it("returns null for qualified company", () => {
    const result = checkDisqualifiers(makeCompany(), baseICP);
    expect(result).toBeNull();
  });

  it("disqualifies too-small companies", () => {
    const company = makeCompany({ employee_count: 5 });
    const result = checkDisqualifiers(company, baseICP);
    expect(result).toBe("employee_count < 10");
  });

  it("disqualifies too-large companies", () => {
    const company = makeCompany({ employee_count: 20000 });
    const result = checkDisqualifiers(company, baseICP);
    expect(result).toBe("employee_count > 10000");
  });

  it("disqualifies excluded industries", () => {
    const icp: ICP = {
      company_profile: { industry_exclude: ["Insurance", "Government"] },
      disqualifiers: [],
    };
    const company = makeCompany({ industry: "Insurance Brokerage" });
    const result = checkDisqualifiers(company, icp);
    expect(result).toBe("Excluded industry: Insurance");
  });

  it("passes when no disqualifiers defined", () => {
    const result = checkDisqualifiers(makeCompany(), {});
    expect(result).toBeNull();
  });

  it("handles null employee count gracefully", () => {
    const company = makeCompany({ employee_count: undefined });
    const result = checkDisqualifiers(company, baseICP);
    expect(result).toBeNull();
  });
});
