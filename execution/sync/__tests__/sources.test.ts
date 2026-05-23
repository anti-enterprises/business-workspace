import { describe, it, expect } from "vitest";
import {
  mergeSources,
  Source,
  RepoSourceFile,
  PulseSourceFile,
} from "../../types/source.js";

function makeSource(overrides: Partial<Source> & { id: string }): Source {
  return {
    label: "Test Source",
    url: "https://example.com",
    kind: "web_page",
    strategic_role: "industry_signal",
    health: "healthy",
    status: "active",
    ...overrides,
  };
}

function toMap(sources: Source[]): Map<string, Source> {
  return new Map(sources.map((s) => [s.id, s]));
}

describe("mergeSources", () => {
  it("merges overlapping sources with correct field ownership", () => {
    const repo = toMap([
      makeSource({
        id: "src-1",
        label: "Repo Label",
        url: "https://repo.com",
        health: "unknown",
        status: "paused",
      }),
    ]);
    const pulse = toMap([
      makeSource({
        id: "src-1",
        label: "Pulse Label",
        url: "https://pulse.com",
        health: "warning",
        status: "active",
      }),
    ]);

    const result = mergeSources(repo, pulse);

    expect(result.merged).toHaveLength(1);
    const merged = result.merged[0];
    // Repo wins for curated fields
    expect(merged.label).toBe("Repo Label");
    expect(merged.url).toBe("https://repo.com");
    expect(merged.status).toBe("paused");
    // Pulse wins for health
    expect(merged.health).toBe("warning");
    expect(result.updated).toBe(1);
  });

  it("adds sources only in repo", () => {
    const repo = toMap([makeSource({ id: "repo-only" })]);
    const pulse = toMap([]);

    const result = mergeSources(repo, pulse);

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].id).toBe("repo-only");
    expect(result.added).toBe(1);
  });

  it("adds sources only in Pulse", () => {
    const repo = toMap([]);
    const pulse = toMap([makeSource({ id: "pulse-only" })]);

    const result = mergeSources(repo, pulse);

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].id).toBe("pulse-only");
    expect(result.added).toBe(1);
  });

  it("handles role re-categorization from repo", () => {
    const repo = toMap([
      makeSource({ id: "src-1", strategic_role: "direct_competitor" }),
    ]);
    const pulse = toMap([
      makeSource({ id: "src-1", strategic_role: "industry_signal" }),
    ]);

    const result = mergeSources(repo, pulse);

    expect(result.merged[0].strategic_role).toBe("direct_competitor"); // repo wins
  });

  it("counts unchanged sources correctly", () => {
    const source = makeSource({ id: "src-1" });
    const repo = toMap([source]);
    const pulse = toMap([{ ...source }]);

    const result = mergeSources(repo, pulse);

    expect(result.unchanged).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.added).toBe(0);
  });

  it("preserves tags from repo side during merge", () => {
    const repo = toMap([
      makeSource({ id: "src-1", tags: ["ai_agency", "market_signal"] }),
    ]);
    const pulse = toMap([
      makeSource({ id: "src-1", tags: undefined }),
    ]);

    const result = mergeSources(repo, pulse);

    expect(result.merged[0].tags).toEqual(["ai_agency", "market_signal"]);
  });

  it("handles mix of add, update, and unchanged", () => {
    const repo = toMap([
      makeSource({ id: "unchanged", label: "Same" }),
      makeSource({ id: "updated", label: "New Label" }),
      makeSource({ id: "repo-only" }),
    ]);
    const pulse = toMap([
      makeSource({ id: "unchanged", label: "Same" }),
      makeSource({ id: "updated", label: "Old Label", health: "warning" }),
      makeSource({ id: "pulse-only" }),
    ]);

    const result = mergeSources(repo, pulse);

    expect(result.merged).toHaveLength(4);
    expect(result.added).toBe(2); // repo-only + pulse-only
    expect(result.updated).toBe(1); // updated
    expect(result.unchanged).toBe(1); // unchanged
  });
});

describe("Zod schemas", () => {
  it("validates a valid RepoSourceFile", () => {
    const data = {
      schema_version: "1",
      strategic_role: "trust_network",
      sources: [
        {
          id: "src-1",
          url: "https://example.com",
          label: "Test",
          kind: "youtube",
          strategic_role: "trust_network",
          health: "healthy",
          status: "active",
        },
      ],
    };
    expect(() => RepoSourceFile.parse(data)).not.toThrow();
  });

  it("rejects invalid source kind", () => {
    const data = {
      schema_version: "1",
      strategic_role: "trust_network",
      sources: [
        {
          id: "src-1",
          label: "Test",
          kind: "invalid_kind",
          strategic_role: "trust_network",
        },
      ],
    };
    expect(() => RepoSourceFile.parse(data)).toThrow();
  });

  it("rejects invalid strategic role", () => {
    const data = {
      schema_version: "1",
      strategic_role: "bad_role",
      sources: [],
    };
    expect(() => RepoSourceFile.parse(data)).toThrow();
  });

  it("allows nullable url", () => {
    const data = {
      schema_version: "1",
      strategic_role: "industry_signal",
      sources: [
        {
          id: "src-1",
          url: null,
          label: "TBD Source",
          kind: "web_page",
          strategic_role: "industry_signal",
        },
      ],
    };
    const parsed = RepoSourceFile.parse(data);
    expect(parsed.sources[0].url).toBeNull();
  });

  it("validates source with tags", () => {
    const data = {
      schema_version: "1",
      strategic_role: "trust_network",
      sources: [
        {
          id: "src-1",
          url: "https://example.com",
          label: "Tagged Source",
          kind: "youtube",
          strategic_role: "trust_network",
          tags: ["ai_agency", "market_signal"],
        },
      ],
    };
    const parsed = RepoSourceFile.parse(data);
    expect(parsed.sources[0].tags).toEqual(["ai_agency", "market_signal"]);
  });

  it("allows source without tags (backward compat)", () => {
    const data = {
      schema_version: "1",
      strategic_role: "industry_signal",
      sources: [
        {
          id: "src-1",
          url: "https://example.com",
          label: "No Tags",
          kind: "web_page",
          strategic_role: "industry_signal",
        },
      ],
    };
    const parsed = RepoSourceFile.parse(data);
    expect(parsed.sources[0].tags).toBeUndefined();
  });

  it("validates PulseSourceFile", () => {
    const data = {
      schema_version: "1",
      typed_at: "2026-04-25",
      sources: [
        {
          id: "src-1",
          url: "https://example.com",
          label: "Test",
          kind: "web_page",
          strategic_role: "direct_competitor",
          health: "healthy",
          status: "active",
        },
      ],
    };
    expect(() => PulseSourceFile.parse(data)).not.toThrow();
  });
});
