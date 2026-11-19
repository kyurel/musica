import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NotMember } from "@/components/not-member";
import { ExportButton } from "@/components/export-button";
import { PlayButton, PlayerProvider } from "@/components/player";
import { notation } from "@/lib/keys";
import { playable, type TrackRow } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";
import { deleteCrate, moveInCrate, removeFromCrate, renameCrate } from "../actions";

export const dynamic = "force-dynamic";

export default async function CratePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const db = await createClient();
  const { data: member } = await db.rpc("is_member");
  if (!member) return <NotMember />;
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: crate }, { data: rows }] = await Promise.all([
    db.from("crates").select("id, name").eq("id", id).is("deleted_at", null).maybeSingle(),
    db.from("crate_tracks")
      .select("position, track:tracks(id, title, artist, bpm, musical_key, deleted_at, genre:genres(slug, name), versions(id, preview_key, preview_lufs, created_at))")
      .eq("crate_id", id).order("position").order("added_at"),
  ]);
  if (!crate) notFound();
  const tracks = (rows ?? []).map((r) => r.track as unknown as TrackRow & { deleted_at: string | null })
    .filter((t) => t && !t.deleted_at);

  return (
    <PlayerProvider>
    <div className="space-y-4">
      <Link href="/crates" className="text-sm text-muted-foreground hover:text-foreground">← Crates</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{crate.name}</h1>
        {tracks.length > 0 && <ExportButton query={new URLSearchParams({ crate: id, name: crate.name }).toString()} />}
      </div>
      {sp.error && <p className="rounded-md border border-red-600 p-3 text-sm text-red-600">{sp.error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" /><TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Artist</TableHead>
            <TableHead>Genre</TableHead><TableHead className="text-right">BPM</TableHead><TableHead>Key</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tracks.length === 0 && (
            <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
              Empty. Add tracks from a track&apos;s page.
            </TableCell></TableRow>
          )}
          {tracks.map((t, i) => {
            const v = playable(t);
            return (
              <TableRow key={t.id}>
                <TableCell>{v && <PlayButton versionId={v.id} title={t.title} lufs={v.preview_lufs} />}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium"><Link href={`/tracks/${t.id}`} className="hover:underline">{t.title}</Link></TableCell>
                <TableCell>{t.artist}</TableCell>
                <TableCell>{t.genre?.name}</TableCell>
                <TableCell className="text-right tabular-nums">{t.bpm != null ? Number(t.bpm).toFixed(1) : ""}</TableCell>
                <TableCell title={notation(t.musical_key)}>{t.musical_key}</TableCell>
                <TableCell className="flex justify-end gap-1">
                  <form action={moveInCrate.bind(null, id, t.id, -1)}><Button size="sm" variant="ghost" disabled={i === 0} aria-label="Move up">↑</Button></form>
                  <form action={moveInCrate.bind(null, id, t.id, 1)}><Button size="sm" variant="ghost" disabled={i === tracks.length - 1} aria-label="Move down">↓</Button></form>
                  <form action={removeFromCrate.bind(null, id, t.id)}><Button size="sm" variant="ghost" aria-label="Remove from crate">✕</Button></form>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-end gap-6 border-t pt-4 text-sm">
        <form action={renameCrate.bind(null, id)} className="flex items-center gap-2">
          <Input name="name" defaultValue={crate.name} className="w-64" required maxLength={200} aria-label="Crate name" />
          <Button size="sm" variant="outline" type="submit">Rename</Button>
        </form>
        <form action={deleteCrate.bind(null, id)} className="flex items-center gap-2">
          <label className="flex items-center gap-1"><input type="checkbox" name="confirm" value="yes" /> yes, delete</label>
          <Button size="sm" variant="outline" type="submit">Delete crate</Button>
        </form>
      </div>
    </div>
    </PlayerProvider>
  );
}
