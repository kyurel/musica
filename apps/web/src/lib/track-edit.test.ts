import { describe, expect, it } from "vitest";
import { confirmGenre, diff, EditError, parseLabels, readForm, scaleBpm, type TrackFields } from "./track-edit";

const base: TrackFields = {
  title: "Anxious", artist: "Rødhåd", source: "reference", genre_id: 1, bpm: 140, musical_key: "8A",
  energy: null, rating: null, labels: ["gig"], notes: null,
};

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const v = { title: "Anxious", artist: "Rødhåd", source: "reference", genre_id: "1", bpm: "140", musical_key: "8A",
    energy: "", rating: "", labels: "gig", notes: "", ...over };
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
}

describe("track edit", () => {
  it("changes nothing when nothing changed", () => {
    expect(diff(base, readForm(form()))).toEqual({});
    expect(diff({ ...base, bpm: "140.00" as unknown as number }, readForm(form()))).toEqual({});
  });

  it("makes edited analysis values the person's own", () => {
    expect(diff(base, readForm(form({ bpm: "142.5", musical_key: "9A" })))).toEqual({
      bpm: 142.5, bpm_source: "user", bpm_confidence: 1,
      musical_key: "9A", key_source: "user", key_confidence: 1,
    });
    expect(diff(base, readForm(form({ genre_id: "" })))).toEqual({ genre_id: null, genre_source: null, genre_confidence: null });
  });

  it("only sends changed plain fields", () => {
    expect(diff(base, readForm(form({ rating: "4", labels: "gig, Friday Set,gig" })))).toEqual({
      rating: 4, labels: ["gig", "friday set"],
    });
  });

  it("rejects bad input with a readable message", () => {
    expect(() => readForm(form({ title: " " }))).toThrow(EditError);
    expect(() => readForm(form({ bpm: "500" }))).toThrow("BPM");
    expect(() => readForm(form({ musical_key: "13A" }))).toThrow("Camelot");
    expect(() => readForm(form({ rating: "6" }))).toThrow("Rating");
    expect(() => readForm(form({ source: "stolen" }))).toThrow("source");
  });

  it("halves and doubles BPM", () => {
    expect(scaleBpm(287, 0.5)).toEqual({ bpm: 143.5, bpm_source: "user", bpm_confidence: 1 });
    expect(scaleBpm(71.25, 2).bpm).toBe(142.5);
    expect(() => scaleBpm(300, 2)).toThrow();
    expect(() => scaleBpm(null, 2)).toThrow();
  });

  it("confirms a genre and clears review", () => {
    expect(confirmGenre()).toEqual({ genre_source: "user", genre_confidence: 1, needs_review: false });
  });

  it("cleans labels", () => {
    expect(parseLabels(" WIP ,, peak   time, wip")).toEqual(["wip", "peak time"]);
  });
});
