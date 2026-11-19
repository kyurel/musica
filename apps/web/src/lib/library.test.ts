import { describe, expect, it } from "vitest";
import { filterName, newestFile, parseFilters } from "./library";

describe("export helpers", () => {
  it("picks the newest live file", () => {
    const v = (path_hint: string | null, created_at: string, deleted_at: string | null = null) =>
      ({ path_hint, duration_s: null, created_at, deleted_at });
    const t = { id: "1", title: "t", artist: null,
      versions: [v("a.wav", "2026-01"), v("b.wav", "2026-03"), v("c.wav", "2026-05", "2026-06"), v(null, "2026-07")] };
    expect(newestFile(t)?.path_hint).toBe("b.wav");
    expect(newestFile({ ...t, versions: [] })).toBeNull();
  });

  it("names a playlist like the worker does", () => {
    expect(filterName(parseFilters({ genre: "psytrance", bpm_min: "140", bpm_max: "146" }))).toBe("psytrance 140-146 bpm");
    expect(filterName(parseFilters({ key: "8A", mixable: "1" }))).toBe("8A mix");
    expect(filterName(parseFilters({}))).toBe("All tracks");
  });
});
