import { describe, expect, it } from "vitest";
import {
  parseHypothesis,
  selectWeakHypotheses,
  formatResearchQuery,
  type Hypothesis,
} from "../pulse-bridge.js";

// --- Fixtures ---

const proposedWeakWithDirection = `
id: H101
code: H101
title: Sample weak hypothesis with direction
statement: |
  Multi-line statement
  that should round-trip verbatim.
state: proposed
confidence: 0.45
age_days: 3
auto_generated: true
created_at: 2026-05-01T00:00:00Z
last_updated: 2026-05-10T00:00:00Z
last_state_change: 2026-05-01T00:00:00Z
direction_ids:
  - D001
supporting_atom_ids:
  - atom-a
  - atom-b
contradicting_atom_ids:
  - atom-c
`;

const proposedStrong = `
id: H102
code: H102
title: Strong proposed hypothesis
statement: Strong, well-supported.
state: proposed
confidence: 0.85
age_days: 1
auto_generated: false
created_at: 2026-05-01T00:00:00Z
last_updated: 2026-05-10T00:00:00Z
last_state_change: 2026-05-01T00:00:00Z
direction_ids:
  - D002
supporting_atom_ids:
  - atom-x
`;

const retiredWeak = `
id: H103
code: H103
title: Retired weak hypothesis
statement: Should never be selected.
state: retired
confidence: 0.4
age_days: 30
auto_generated: false
created_at: 2026-04-01T00:00:00Z
last_updated: 2026-04-15T00:00:00Z
last_state_change: 2026-04-15T00:00:00Z
direction_ids:
  - D001
supporting_atom_ids: []
`;

const proposedWeakNoDirection = `
id: H104
code: H104
title: Weak but no direction
statement: Floating, not tied to strategy.
state: proposed
confidence: 0.3
age_days: 5
auto_generated: true
created_at: 2026-05-01T00:00:00Z
last_updated: 2026-05-10T00:00:00Z
last_state_change: 2026-05-01T00:00:00Z
direction_ids: []
supporting_atom_ids:
  - atom-y
`;

// --- parseHypothesis ---

describe("parseHypothesis", () => {
  it("parses a well-formed hypothesis", () => {
    const h = parseHypothesis(proposedWeakWithDirection);
    expect(h.id).toBe("H101");
    expect(h.state).toBe("proposed");
    expect(h.confidence).toBe(0.45);
    expect(h.direction_ids).toEqual(["D001"]);
    expect(h.statement).toContain("verbatim");
  });

  it("rejects missing required fields", () => {
    expect(() => parseHypothesis(`id: H999`)).toThrow();
  });

  it("rejects confidence out of [0,1] range", () => {
    const bad = proposedWeakWithDirection.replace("confidence: 0.45", "confidence: 1.5");
    expect(() => parseHypothesis(bad)).toThrow();
  });
});

// --- selectWeakHypotheses ---

describe("selectWeakHypotheses", () => {
  const all: Hypothesis[] = [
    parseHypothesis(proposedWeakWithDirection),
    parseHypothesis(proposedStrong),
    parseHypothesis(retiredWeak),
    parseHypothesis(proposedWeakNoDirection),
  ];

  it("selects state=proposed AND confidence<0.6 AND direction_ids non-empty (defaults)", () => {
    const weak = selectWeakHypotheses(all);
    expect(weak.map((h) => h.id)).toEqual(["H101"]);
  });

  it("excludes retired hypotheses", () => {
    const weak = selectWeakHypotheses(all);
    expect(weak.find((h) => h.id === "H103")).toBeUndefined();
  });

  it("excludes high-confidence hypotheses", () => {
    const weak = selectWeakHypotheses(all);
    expect(weak.find((h) => h.id === "H102")).toBeUndefined();
  });

  it("excludes hypotheses without direction_ids by default", () => {
    const weak = selectWeakHypotheses(all);
    expect(weak.find((h) => h.id === "H104")).toBeUndefined();
  });

  it("respects custom confidence threshold", () => {
    const weak = selectWeakHypotheses(all, { confidenceThreshold: 0.9 });
    expect(weak.map((h) => h.id).sort()).toEqual(["H101", "H102"]);
  });

  it("can disable the direction_ids requirement", () => {
    const weak = selectWeakHypotheses(all, { requireDirections: false });
    expect(weak.map((h) => h.id).sort()).toEqual(["H101", "H104"]);
  });
});

// --- formatResearchQuery ---

describe("formatResearchQuery", () => {
  const hyp = parseHypothesis(proposedWeakWithDirection);
  const out = formatResearchQuery(hyp);

  it("emits frontmatter with originating hypothesis id", () => {
    expect(out.body).toMatch(/^---\n/);
    expect(out.body).toMatch(/hypothesis_id: H101/);
    expect(out.body).toMatch(/origin: pulse-bridge/);
  });

  it("includes the hypothesis statement verbatim", () => {
    expect(out.body).toContain("Multi-line statement");
    expect(out.body).toContain("that should round-trip verbatim.");
  });

  it("derives a vault tag slug from the hypothesis id and title", () => {
    expect(out.vaultTag).toMatch(/^h101-/);
    expect(out.vaultTag).not.toContain(" ");
    expect(out.vaultTag).toMatch(/^[a-z0-9-]+$/);
  });

  it("produces a stable filename", () => {
    expect(out.filename).toBe(`${out.vaultTag}.md`);
  });

  it("includes a Decision context section even when none provided", () => {
    expect(out.body).toContain("## Decision context");
  });
});
