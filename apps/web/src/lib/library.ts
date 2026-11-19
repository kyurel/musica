// Library search: turns URL filters into one Supabase query. RLS does the access control.
import type { SupabaseClient } from "@supabase/supabase-js";
import { compatibleKeys } from "./keys";

export const PAGE_SIZE = 50;

export type Filters = {
  q?: string;
  genre?: string;
  bpmMin?: number;
  bpmMax?: number;
  key?: string;
  mixable?: boolean;
  source?: string;
  review?: boolean;
  page?: number;
};

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const s = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const n = (k: string) => {
    const v = Number(s(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  return {
    q: s("q")?.slice(0, 200),
    genre: s("genre"),
    bpmMin: n("bpm_min"),
    bpmMax: n("bpm_max"),
    key: s("key"),
    mixable: s("mixable") === "1",
    source: s("source"),
    review: s("review") === "1",
    page: n("page") ?? 1,
  };
}

export type TrackRow = {
  id: string;
  title: string;
  artist: string | null;
  source: string;
  bpm: number | null;
  bpm_source: string | null;
  musical_key: string | null;
  rating: number | null;
  labels: string[];
  needs_review: boolean;
  genre: { slug: string; name: string } | null;
  versions: { id: string; preview_key: string | null; preview_lufs: number | null; created_at: string }[];
};

/** The newest version that has a preview, for playback. */
export function playable(t: TrackRow) {
  return [...(t.versions ?? [])]
    .filter((v) => v.preview_key)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

const TRACK_COLUMNS =
  "id, title, artist, source, bpm, bpm_source, musical_key, rating, labels, needs_review, genre:genres(slug, name), versions(id, preview_key, preview_lufs, created_at)";

async function genreId(db: SupabaseClient, f: Filters) {
  if (!f.genre) return undefined;
  const { data } = await db.from("genres").select("id").eq("slug", f.genre).maybeSingle();
  return (data?.id as number | undefined) ?? -1;
}

/** Tracks matching the filters, newest first. RLS limits it to members.
 *  Not async: an awaited query builder would run the query. */
function filtered(db: SupabaseClient, f: Filters, genre: number | undefined, columns: string, count?: "exact") {
  let query = db.from("tracks").select(columns, count ? { count } : undefined).is("deleted_at", null);

  if (f.q) query = query.textSearch("search", f.q, { type: "websearch", config: "simple" });
  if (genre !== undefined) query = query.eq("genre_id", genre);
  if (f.bpmMin) query = query.gte("bpm", f.bpmMin);
  if (f.bpmMax) query = query.lte("bpm", f.bpmMax);
  if (f.key) query = f.mixable ? query.in("musical_key", compatibleKeys(f.key)) : query.eq("musical_key", f.key);
  if (f.source) query = query.eq("source", f.source);
  if (f.review) query = query.eq("needs_review", true);
  return query.order("created_at", { ascending: false });
}

export async function searchTracks(db: SupabaseClient, f: Filters) {
  const page = f.page ?? 1;
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await filtered(db, f, await genreId(db, f), TRACK_COLUMNS, "exact").range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { tracks: (data ?? []) as unknown as TrackRow[], count: count ?? 0 };
}

export type ExportRow = {
  id: string;
  title: string;
  artist: string | null;
  versions: { path_hint: string | null; duration_s: number | null; created_at: string; deleted_at: string | null }[];
};

/** Every track matching the filters (all pages), with the file info a playlist needs. */
export async function exportTracks(db: SupabaseClient, f: Filters, limit = 50_000) {
  const out: ExportRow[] = [];
  const step = 1000;
  const genre = await genreId(db, f);
  for (let from = 0; from < limit; from += step) {
    const { data, error } = await filtered(db, f, genre, "id, title, artist, versions(path_hint, duration_s, created_at, deleted_at)")
      .range(from, from + step - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as ExportRow[]));
    if (!data || data.length < step) break;
  }
  return out;
}

/** The newest live version that has a file on the Macs. */
export function newestFile(t: ExportRow) {
  return [...(t.versions ?? [])]
    .filter((v) => v.path_hint && !v.deleted_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/** Playlist name from the filters, like the worker's default. */
export function filterName(f: Filters) {
  const bpm = f.bpmMin || f.bpmMax ? `${f.bpmMin ?? ""}-${f.bpmMax ?? ""} bpm` : null;
  const key = f.key ? (f.mixable ? `${f.key} mix` : f.key) : null;
  const parts = [f.genre, f.source, key, bpm, f.q && `'${f.q}'`, f.review && "review"];
  return parts.filter(Boolean).join(" ") || "All tracks";
}
