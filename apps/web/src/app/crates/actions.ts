"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { crateName, move } from "@/lib/crates";

const UUID = /^[0-9a-f-]{36}$/i;
const check = (...ids: string[]) => { if (!ids.every((id) => UUID.test(id))) redirect("/crates"); };
const fail = (e: unknown) => (e instanceof Error ? e.message : "Could not save");

async function orderOf(db: Awaited<ReturnType<typeof createClient>>, crateId: string) {
  const { data, error } = await db.from("crate_tracks").select("track_id").eq("crate_id", crateId)
    .order("position").order("added_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.track_id as string);
}

export async function createCrate(form: FormData) {
  const db = await createClient();
  let target = "/crates";
  try {
    const { data, error } = await db.from("crates").insert({ name: crateName(form.get("name")) }).select("id").single();
    if (error) throw new Error(error.message);
    target = `/crates/${data.id}`;
  } catch (e) {
    target = `/crates?error=${encodeURIComponent(fail(e))}`;
  }
  revalidatePath("/crates");
  redirect(target);
}

export async function renameCrate(crateId: string, form: FormData) {
  check(crateId);
  const db = await createClient();
  let q = "";
  try {
    const { error } = await db.from("crates").update({ name: crateName(form.get("name")) }).eq("id", crateId);
    if (error) throw new Error(error.message);
  } catch (e) {
    q = `?error=${encodeURIComponent(fail(e))}`;
  }
  revalidatePath(`/crates/${crateId}`);
  redirect(`/crates/${crateId}${q}`);
}

/** Soft delete: the crate disappears but stays in the database and the change log. */
export async function deleteCrate(crateId: string, form: FormData) {
  check(crateId);
  if (form.get("confirm") !== "yes") redirect(`/crates/${crateId}?error=${encodeURIComponent("Tick the box to confirm")}`);
  const db = await createClient();
  await db.from("crates").update({ deleted_at: new Date().toISOString() }).eq("id", crateId);
  revalidatePath("/crates");
  redirect("/crates");
}

export async function addToCrate(trackId: string, form: FormData) {
  const crateId = String(form.get("crate_id") ?? "");
  check(trackId, crateId);
  const db = await createClient();
  let q = "?saved=1";
  try {
    const order = await orderOf(db, crateId);
    if (!order.includes(trackId)) {
      const { error } = await db.from("crate_tracks").insert({ crate_id: crateId, track_id: trackId, position: order.length });
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    q = `?error=${encodeURIComponent(fail(e))}`;
  }
  revalidatePath(`/tracks/${trackId}`);
  revalidatePath(`/crates/${crateId}`);
  redirect(`/tracks/${trackId}${q}`);
}

export async function removeFromCrate(crateId: string, trackId: string) {
  check(crateId, trackId);
  const db = await createClient();
  await db.from("crate_tracks").delete().eq("crate_id", crateId).eq("track_id", trackId);
  revalidatePath(`/crates/${crateId}`);
  redirect(`/crates/${crateId}`);
}

export async function moveInCrate(crateId: string, trackId: string, dir: -1 | 1) {
  check(crateId, trackId);
  const db = await createClient();
  let q = "";
  try {
    for (const r of move(await orderOf(db, crateId), trackId, dir)) {
      const { error } = await db.from("crate_tracks").update({ position: r.position })
        .eq("crate_id", crateId).eq("track_id", r.track_id);
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    q = `?error=${encodeURIComponent(fail(e))}`;
  }
  revalidatePath(`/crates/${crateId}`);
  redirect(`/crates/${crateId}${q}`);
}
