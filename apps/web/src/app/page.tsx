import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NotMember } from "@/components/not-member";
import { ALL_KEYS, notation } from "@/lib/keys";
import { PAGE_SIZE, parseFilters, playable, searchTracks } from "@/lib/library";
import { PlayButton, PlayerProvider } from "@/components/player";
import { ExportButton } from "@/components/export-button";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SOURCES = ["ours", "reference", "commercial", "promo", "sample_pack"];

export default async function LibraryPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const { data: member } = await supabase.rpc("is_member");
  if (!member) return <NotMember />;

  const sp = await searchParams;
  const f = parseFilters(sp);
  const [{ tracks, count }, { data: genres }] = await Promise.all([
    searchTracks(supabase, f),
    supabase.from("genres").select("slug, name").is("parent_id", null).order("sort"),
  ]);
  const page = f.page ?? 1;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const query = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
  const pageLink = (p: number) => {
    const q = new URLSearchParams(query);
    q.set("page", String(p));
    return `/?${q}`;
  };

  return (
    <PlayerProvider>
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Library</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{count} tracks</span>
          {count > 0 && <ExportButton query={query.toString()} />}
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-2" method="get">
        <Input name="q" placeholder="Search title, artist, notes" defaultValue={f.q} className="w-64" />
        <Select name="genre" defaultValue={f.genre ?? ""}>
          <option value="">All genres</option>
          {genres?.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
        </Select>
        <Input name="bpm_min" type="number" placeholder="BPM from" defaultValue={f.bpmMin} className="w-28" />
        <Input name="bpm_max" type="number" placeholder="BPM to" defaultValue={f.bpmMax} className="w-28" />
        <Select name="key" defaultValue={f.key ?? ""}>
          <option value="">Any key</option>
          {ALL_KEYS.map((k) => <option key={k} value={k}>{k} · {notation(k)}</option>)}
          <option value="atonal">atonal</option>
        </Select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="mixable" value="1" defaultChecked={f.mixable} /> mixable keys
        </label>
        <Select name="source" defaultValue={f.source ?? ""}>
          <option value="">Any source</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </Select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="review" value="1" defaultChecked={f.review} /> needs review
        </label>
        <Button type="submit" size="sm">Filter</Button>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Clear</Link>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Title</TableHead>
            <TableHead>Artist</TableHead>
            <TableHead>Genre</TableHead>
            <TableHead className="text-right">BPM</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Labels</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tracks.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                No tracks match. Add files on a Mac with <code>musica-worker add</code>.
              </TableCell>
            </TableRow>
          )}
          {tracks.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                {(() => {
                  const v = playable(t);
                  return v ? <PlayButton versionId={v.id} title={t.title} lufs={v.preview_lufs} /> : null;
                })()}
              </TableCell>
              <TableCell className="font-medium">
                {t.title}
                {t.needs_review && <Badge className="ml-2">review</Badge>}
              </TableCell>
              <TableCell>{t.artist}</TableCell>
              <TableCell>{t.genre?.name}</TableCell>
              <TableCell className="text-right tabular-nums" title={t.bpm_source ?? undefined}>
                {t.bpm != null ? Number(t.bpm).toFixed(1) : ""}
              </TableCell>
              <TableCell title={notation(t.musical_key)}>
                {t.musical_key && <>{t.musical_key} <span className="text-muted-foreground">{notation(t.musical_key)}</span></>}
              </TableCell>
              <TableCell>{t.rating ? "★".repeat(t.rating) : ""}</TableCell>
              <TableCell className="space-x-1">{t.labels.map((l) => <Badge key={l}>{l}</Badge>)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          {page > 1 && <Link href={pageLink(page - 1)}>Previous</Link>}
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          {page < pages && <Link href={pageLink(page + 1)}>Next</Link>}
        </div>
      )}
    </div>
    </PlayerProvider>
  );
}
