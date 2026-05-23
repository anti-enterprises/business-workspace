import { describe, it, expect } from "vitest";
import { normalizeToXUrl } from "../x-apify.js";

describe("normalizeToXUrl", () => {
  it("returns full URLs unchanged", () => {
    expect(normalizeToXUrl("https://x.com/sama")).toBe("https://x.com/sama");
    expect(normalizeToXUrl("https://x.com/i/user/2577596593")).toBe(
      "https://x.com/i/user/2577596593",
    );
    expect(normalizeToXUrl("https://twitter.com/sama")).toBe("https://twitter.com/sama");
  });

  it("maps a bare handle to a profile URL", () => {
    expect(normalizeToXUrl("sama")).toBe("https://x.com/sama");
    expect(normalizeToXUrl("@sama")).toBe("https://x.com/sama");
  });

  it("maps a numeric user ID to the i/user/<id> URL form", () => {
    expect(normalizeToXUrl("2577596593")).toBe("https://x.com/i/user/2577596593");
    expect(normalizeToXUrl("776585502606721024")).toBe(
      "https://x.com/i/user/776585502606721024",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeToXUrl("  sama  ")).toBe("https://x.com/sama");
  });
});
