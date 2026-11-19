import { NextResponse } from "next/server";
import { clientFromBearer } from "@/lib/supabase/bearer";
import { presign, previewKey } from "@/lib/r2";

const UUID = /^[0-9a-f-]{36}$/i;

// The worker asks for a one-time upload URL for one version's preview.
export async function POST(request: Request) {
  const db = clientFromBearer(request);
  if (!db) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { data: member } = await db.rpc("is_member");
  if (!member) return NextResponse.json({ error: "not a member" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const versionId = String(body.version_id ?? "");
  if (!UUID.test(versionId)) return NextResponse.json({ error: "bad version_id" }, { status: 400 });
  const { data: version } = await db.from("versions").select("id").eq("id", versionId).maybeSingle();
  if (!version) return NextResponse.json({ error: "no such version" }, { status: 404 });

  const key = previewKey(versionId);
  return NextResponse.json({ url: await presign("PUT", key), key });
}
