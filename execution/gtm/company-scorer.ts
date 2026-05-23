import type { ICP } from "../types/offer.js";
import type { UpsertCompanyInput, SignalData } from "../types/company.js";

interface ScoringResult {
  score: number;
  notes: string[];
}

/**
 * Score a company against the ICP using a rule-based rubric.
 * Returns 0-100.
 */
export function scoreCompany(
  company: UpsertCompanyInput & { signals_found?: SignalData },
  icp: ICP,
): ScoringResult {
  let score = 0;
  const notes: string[] = [];
  const cp = icp.company_profile ?? {} as NonNullable<ICP["company_profile"]>;
  const rubric = icp.scoring_rubric ?? {} as NonNullable<ICP["scoring_rubric"]>;

  // --- Firmographic (default 30 pts) ---
  const firmoMax = rubric.firmographic ?? 30;

  // Industry match
  let targetIndustries = cp.industry ?? [];
  if (typeof targetIndustries === "string") {
    targetIndustries = [targetIndustries];
  }
  const companyIndustry = (company.industry ?? "").toLowerCase();
  if (targetIndustries.length > 0) {
    if (targetIndustries.some((ind) => companyIndustry.includes(ind.toLowerCase()))) {
      score += firmoMax * 0.5;
      notes.push("Industry match");
    } else {
      score += firmoMax * 0.15;
      notes.push("Industry partial");
    }
  }

  // Employee count match
  const empCount = company.employee_count;
  const empMin = cp.employee_count_min ?? 0;
  const empMax = cp.employee_count_max ?? 999999;
  if (empCount != null) {
    if (empCount >= empMin && empCount <= empMax) {
      score += firmoMax * 0.33;
      notes.push("Employee count in range");
    } else if (empCount >= empMin * 0.5 && empCount <= empMax * 1.5) {
      score += firmoMax * 0.15;
      notes.push("Employee count near range");
    }
  }

  // Geography match
  let targetGeo = cp.geography ?? [];
  if (typeof targetGeo === "string") {
    targetGeo = [targetGeo];
  }
  const companyCountry = (company.country ?? "").toLowerCase();
  const companyLocation = (company.location ?? "").toLowerCase();
  if (targetGeo.length > 0) {
    if (
      targetGeo.some(
        (g) =>
          companyCountry.includes(g.toLowerCase()) ||
          companyLocation.includes(g.toLowerCase()),
      )
    ) {
      score += firmoMax * 0.17;
      notes.push("Geography match");
    }
  }

  // --- Technographic (default 20 pts) ---
  const technoMax = rubric.technographic ?? 20;
  let techStack = company.tech_stack ?? [];
  if (typeof techStack === "string") {
    techStack = [techStack];
  }
  const techStackLower = techStack.map((t) => t.toLowerCase());

  const mustHave = cp.tech_stack_must_have ?? [];
  if (mustHave.length > 0 && mustHave.some((t) => techStackLower.includes(t.toLowerCase()))) {
    score += technoMax * 0.4;
    notes.push("Must-have tech found");
  }

  const complementary = cp.tech_stack_complementary ?? [];
  const compMatches = complementary.filter((t) => techStackLower.includes(t.toLowerCase())).length;
  if (compMatches > 0) {
    score += Math.min(technoMax * 0.2 * compMatches, technoMax * 0.3);
    notes.push(`${compMatches} complementary tech matches`);
  }

  const absence = cp.tech_stack_absence ?? [];
  if (absence.length > 0 && !absence.some((t) => techStackLower.includes(t.toLowerCase()))) {
    score += technoMax * 0.3;
    notes.push("Greenfield opportunity (no competing tech)");
  }

  // --- Signal strength (default 30 pts) ---
  const signalMax = rubric.signal_strength ?? 30;
  const signalData = company.signals_found ?? {};
  const signalStrength = signalData.signal_strength ?? "";

  if (signalStrength === "strong") {
    score += signalMax * 0.5;
    notes.push("Strong signal");
  } else if (signalStrength === "moderate") {
    score += signalMax * 0.33;
    notes.push("Moderate signal");
  } else if (signalStrength === "weak") {
    score += signalMax * 0.17;
    notes.push("Weak signal");
  } else if (Object.keys(signalData).length > 0) {
    score += signalMax * 0.33;
    notes.push("Signal present (unrated)");
  }

  return {
    score: Math.round(Math.min(score, 100) * 10) / 10,
    notes,
  };
}

/**
 * Check if a company hits any disqualifiers.
 * Returns the disqualifier reason, or null if qualified.
 */
export function checkDisqualifiers(
  company: UpsertCompanyInput,
  icp: ICP,
): string | null {
  const disqualifiers = icp.disqualifiers ?? [];
  const cp = icp.company_profile ?? {};
  const empCount = company.employee_count;

  for (const dq of disqualifiers) {
    const dqLower = dq.toLowerCase();

    if (dqLower.includes("employee_count <") && empCount != null) {
      const match = dqLower.match(/employee_count\s*<\s*(\d+)/);
      if (match) {
        const threshold = parseInt(match[1], 10);
        if (empCount < threshold) return dq;
      }
    }

    if (dqLower.includes("employee_count >") && empCount != null) {
      const match = dqLower.match(/employee_count\s*>\s*(\d+)/);
      if (match) {
        const threshold = parseInt(match[1], 10);
        if (empCount > threshold) return dq;
      }
    }
  }

  // Industry exclusion
  const excludedIndustries = cp.industry_exclude ?? [];
  const companyIndustry = (company.industry ?? "").toLowerCase();
  for (const excl of excludedIndustries) {
    if (companyIndustry.includes(excl.toLowerCase())) {
      return `Excluded industry: ${excl}`;
    }
  }

  return null;
}
