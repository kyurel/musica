// Turning the track form into a database update. Pure, so it is unit-tested.
// A value a person sets always wins over analysis: its source becomes 'user' with full
// confidence, and record_analysis() never overwrites a 'user' value.

const CAMELOT = /^(1[0-2]|[1-9])[AB]$/;
export const SOURCES = ["ours", "reference", "commercial", "promo", "sample_pack"] as const;

export type TrackFields = {
  title: string;
  artist: string | null;
  source: string;
  genre_id: number | null;
  bpm: number | null;
  musical_key: string | null;
  energy: number | null;
  rating: number | null;
  labels: string[];
  notes: string | null;
};

export type Patch = Record<string, string | number | boolean | string[] | null>;

export class EditError extends Error {}

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function intIn(v: string, lo: number, hi: number, what: string): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new EditError(`${what} must be ${lo} to ${hi}`);
  return n;
}

export function parseLabels(v: string): string[] {
  const seen = new Set<string>();
  for (const raw of v.split(",")) {
    const l = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (l) seen.add(l);
  }
  return [...seen].slice(0, 30);
}

/** Read the form. Throws EditError with a message for the person on bad input. */
export function readForm(form: FormData): TrackFields {
  const title = text(form.get("title"));
  if (!title || title.length > 500) throw new EditError("Title must be 1 to 500 characters");
  const artist = text(form.get("artist"));
  if (artist.length > 500) throw new EditError("Artist is too long");
  const source = text(form.get("source"));
  if (!(SOURCES as readonly string[]).includes(source)) throw new EditError("Unknown source");

  const bpmText = text(form.get("bpm"));
  let bpm: number | null = null;
  if (bpmText) {
    bpm = Math.round(Number(bpmText) * 100) / 100;
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm >= 400) throw new EditError("BPM must be between 0 and 400");
  }
  const key = text(form.get("musical_key"));
  if (key && key !== "atonal" && !CAMELOT.test(key)) throw new EditError("Key must be a Camelot code like 8A, or atonal");
  const notes = text(form.get("notes"));
  if (notes.length > 20000) throw new EditError("Notes are too long");

  return {
    title,
    artist: artist || null,
    source,
    genre_id: intIn(text(form.get("genre_id")), 1, 32767, "Genre"),
    bpm,
    musical_key: key || null,
    energy: intIn(text(form.get("energy")), 1, 10, "Energy"),
    rating: intIn(text(form.get("rating")), 0, 5, "Rating"),
    labels: parseLabels(text(form.get("labels"))),
    notes: notes || null,
  };
}

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/** Only what changed. Changed BPM, key or genre become the person's own values. */
export function diff(current: TrackFields, next: TrackFields): Patch {
  const patch: Patch = {};
  for (const k of Object.keys(next) as (keyof TrackFields)[]) {
    const cur = k === "bpm" && current.bpm != null ? Number(current.bpm) : current[k];
    if (!same(cur, next[k])) patch[k] = next[k];
  }
  if ("bpm" in patch) Object.assign(patch, { bpm_source: patch.bpm == null ? null : "user", bpm_confidence: patch.bpm == null ? null : 1 });
  if ("musical_key" in patch) Object.assign(patch, { key_source: patch.musical_key == null ? null : "user", key_confidence: patch.musical_key == null ? null : 1 });
  if ("genre_id" in patch) Object.assign(patch, { genre_source: patch.genre_id == null ? null : "user", genre_confidence: patch.genre_id == null ? null : 1 });
  return patch;
}

/** One-click BPM fix: half or double, kept inside the valid range. */
export function scaleBpm(bpm: number | null, factor: 0.5 | 2): Patch {
  if (bpm == null) throw new EditError("No BPM to change");
  const next = Math.round(Number(bpm) * factor * 100) / 100;
  if (next <= 0 || next >= 400) throw new EditError("That BPM is out of range");
  return { bpm: next, bpm_source: "user", bpm_confidence: 1 };
}

/** Accept the suggested genre as the person's own choice. */
export const confirmGenre = (): Patch => ({ genre_source: "user", genre_confidence: 1, needs_review: false });
