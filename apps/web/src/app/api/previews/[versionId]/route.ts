import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { presign } from "@/lib/r2";

// Signed, short-lived playback URL for a preview. Members only (RLS hides other rows).
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const db = await createClient();
  const { data } = await db.from("versions").select("preview_key").eq("id", versionId).maybeSingle();
  if (!data?.preview_key) return NextResponse.json({ error: "no preview" }, { status: 404 });
  return NextResponse.redirect(await presign("GET", data.preview_key), { status: 302 });
}
