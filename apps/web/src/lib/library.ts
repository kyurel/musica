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

export async function searchTracks(db: SupabaseClient, f: Filters) {
  let query = db
    .from("tracks")
    .select("id, title, artist, source, bpm, bpm_source, musical_key, rating, labels, needs_review, genre:genres(slug, name), versions(id, preview_key, preview_lufs, created_at)", { count: "exact" })
    .is("deleted_at", null);

  if (f.q) query = query.textSearch("search", f.q, { type: "websearch", config: "simple" });
  if (f.genre) {
    const { data } = await db.from("genres").select("id").eq("slug", f.genre).maybeSingle();
    query = query.eq("genre_id", data?.id ?? -1);
  }
  if (f.bpmMin) query = query.gte("bpm", f.bpmMin);
  if (f.bpmMax) query = query.lte("bpm", f.bpmMax);
  if (f.key) query = f.mixable ? query.in("musical_key", compatibleKeys(f.key)) : query.eq("musical_key", f.key);
  if (f.source) query = query.eq("source", f.source);
  if (f.review) query = query.eq("needs_review", true);

  const page = f.page ?? 1;
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { tracks: (data ?? []) as unknown as TrackRow[], count: count ?? 0 };
}
