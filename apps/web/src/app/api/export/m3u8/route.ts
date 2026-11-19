import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exportCrate, exportTracks, filterName, newestFile, parseFilters } from "@/lib/library";
import { joinRoot, renderM3u8, safeFilename } from "@/lib/m3u8";

// M3U8 of everything the library page shows for the same filters (all pages, not just
// the one on screen). Paths point into `root`, the library folder on the Mac that will
// open the file, since the two Macs keep the library in different places.
export async function GET(req: Request) {
  const db = await createClient();
  const { data: member } = await db.rpc("is_member");
  if (!member) return NextResponse.json({ error: "not a member" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const root = (sp.root ?? "").trim();
  if (!root.startsWith("/")) {
    return NextResponse.json({ error: "root must be the library folder on your Mac, e.g. /Users/you/Music/Musica" }, { status: 400 });
  }
  const f = parseFilters(sp);
  const name = (sp.name ?? "").trim().slice(0, 200) || filterName(f);

  const crate = sp.crate ?? "";
  if (crate && !/^[0-9a-f-]{36}$/i.test(crate)) return NextResponse.json({ error: "bad crate" }, { status: 400 });
  const tracks = crate ? await exportCrate(db, crate) : await exportTracks(db, f);
  const entries = tracks.flatMap((t) => {
    const v = newestFile(t);
    return v?.path_hint
      ? [{ path: joinRoot(root, v.path_hint), title: t.title, artist: t.artist, duration_s: v.duration_s == null ? null : Number(v.duration_s) }]
      : [];
  });

  const body = renderM3u8({ name, entries });
  const file = `${safeFilename(name)}.m3u8`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "audio/x-mpegurl; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      "Cache-Control": "no-store",
      "X-Musica-Left-Out": String(tracks.length - entries.length),
    },
  });
}
