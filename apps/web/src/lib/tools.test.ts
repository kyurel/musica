import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS, tool } from "./tools";

describe("tools registry", () => {
  it("has unique slugs and links", () => {
    expect(new Set(TOOLS.map((t) => t.slug)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.href)).size).toBe(TOOLS.length);
  });

  it("gives every tool a page", () => {
    for (const t of TOOLS) {
      expect(existsSync(join(__dirname, "../app", t.href, "page.tsx")), t.href).toBe(true);
    }
  });

  it("describes every tool that is not live yet", () => {
    for (const t of TOOLS.filter((x) => x.status !== "live")) expect(t.plan.length, t.slug).toBeGreaterThan(0);
  });

  it("throws on an unknown slug", () => {
    expect(() => tool("nope")).toThrow();
  });
});
