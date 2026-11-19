"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { confirmGenre, diff, EditError, readForm, scaleBpm, type Patch, type TrackFields } from "@/lib/track-edit";

const FIELDS = "title, artist, source, genre_id, bpm, musical_key, energy, rating, labels, notes";
const UUID = /^[0-9a-f-]{36}$/i;

async function apply(id: string, build: (current: TrackFields) => Patch, tags?: number[]) {
  if (!UUID.test(id)) redirect("/");
  const db = await createClient();
  let message: string | null = null;
  try {
    const { data: current, error } = await db.from("tracks").select(FIELDS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!current) throw new EditError("Track not found");
    const patch = build(current as unknown as TrackFields);
    if (Object.keys(patch).length) {
      const { error: e } = await db.from("tracks").update(patch).eq("id", id);
      if (e) throw new Error(e.message);
    }
    if (tags) await setStyleTags(db, id, tags);
  } catch (e) {
    message = e instanceof Error ? e.message : "Could not save";
  }
  revalidatePath(`/tracks/${id}`);
  redirect(`/tracks/${id}${message ? `?error=${encodeURIComponent(message)}` : "?saved=1"}`);
}

async function setStyleTags(db: Awaited<ReturnType<typeof createClient>>, id: string, wanted: number[]) {
  const { data } = await db.from("track_style_tags").select("tag_id").eq("track_id", id);
  const have = new Set((data ?? []).map((r) => r.tag_id as number));
  const add = wanted.filter((t) => !have.has(t));
  const remove = [...have].filter((t) => !wanted.includes(t));
  if (add.length) {
    const { error } = await db.from("track_style_tags").insert(add.map((tag_id) => ({ track_id: id, tag_id })));
    if (error) throw new Error(error.message);
  }
  if (remove.length) {
    const { error } = await db.from("track_style_tags").delete().eq("track_id", id).in("tag_id", remove);
    if (error) throw new Error(error.message);
  }
}

export async function saveTrack(id: string, form: FormData) {
  const tags = form.getAll("style_tag").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  await apply(id, (cur) => diff(cur, readForm(form)), tags);
}

export async function halveBpm(id: string) {
  await apply(id, (cur) => scaleBpm(cur.bpm, 0.5));
}

export async function doubleBpm(id: string) {
  await apply(id, (cur) => scaleBpm(cur.bpm, 2));
}

export async function confirmGenreAction(id: string) {
  await apply(id, (cur) => {
    if (cur.genre_id == null) throw new EditError("Pick a genre first");
    return confirmGenre();
  });
}

export async function markReviewed(id: string) {
  await apply(id, () => ({ needs_review: false }));
}
