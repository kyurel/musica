import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { NotMember } from "@/components/not-member";
import { PlayButton, PlayerProvider } from "@/components/player";
import { ALL_KEYS, notation } from "@/lib/keys";
import { SOURCES } from "@/lib/track-edit";
import { createClient } from "@/lib/supabase/server";
import { confirmGenreAction, doubleBpm, halveBpm, markReviewed, saveTrack } from "./actions";

export const dynamic = "force-dynamic";

type Version = {
  id: string; name: string; path_hint: string | null; codec: string | null; bitrate_kbps: number | null;
  sample_rate: number | null; bit_depth: number | null; duration_s: number | null;
  suspected_fake_lossless: boolean | null; preview_key: string | null; preview_lufs: number | null;
  created_at: string; deleted_at: string | null;
};

const fmtTime = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const source = (s: string | null, c: number | null) => (s ? `${s}${c != null && s !== "user" ? ` ${Math.round(c * 100)}%` : ""}` : "");

export default async function TrackPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const db = await createClient();
  const { data: member } = await db.rpc("is_member");
  if (!member) return <NotMember />;
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: t }, { data: genres }, { data: tags }, { data: trackTags }, { data: history }, { data: people }] = await Promise.all([
    db.from("tracks").select("*, versions(*)").eq("id", id).is("deleted_at", null).maybeSingle(),
    db.from("genres").select("id, name, parent_id, sort").order("sort").order("name"),
    db.from("style_tags").select("id, name").order("name"),
    db.from("track_style_tags").select("tag_id").eq("track_id", id),
    db.from("change_log").select("id, actor, via, op, diff, at").eq("table_name", "tracks").eq("row_id", id)
      .order("at", { ascending: false }).limit(20),
    db.from("allowed_users").select("user_id, github_login"),
  ]);
  if (!t) notFound();

  const versions = ((t.versions ?? []) as Version[]).filter((v) => !v.deleted_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const playable = versions.find((v) => v.preview_key);
  const tops = (genres ?? []).filter((g) => g.parent_id == null);
  const subs = (parent: number) => (genres ?? []).filter((g) => g.parent_id === parent);
  const tagged = new Set((trackTags ?? []).map((r) => r.tag_id));
  const who = new Map((people ?? []).map((p) => [p.user_id, p.github_login]));
  const save = saveTrack.bind(null, id);
  const genreSuggested = t.genre_id != null && t.genre_source !== "user";

  return (
    <PlayerProvider>
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Library</Link>
      </div>
      <div className="flex items-center gap-3">
        {playable && <PlayButton versionId={playable.id} title={t.title} lufs={playable.preview_lufs} />}
        <h1 className="text-xl font-semibold">{t.title}</h1>
        {t.needs_review && <Badge>review</Badge>}
      </div>

      {sp.error && <p className="rounded-md border border-red-600 p-3 text-sm text-red-600">{sp.error}</p>}
      {sp.saved && !sp.error && <p className="text-sm text-green-600">Saved.</p>}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {genreSuggested && (
          <form action={confirmGenreAction.bind(null, id)}>
            <Button size="sm" type="submit">Confirm genre ({source(t.genre_source, t.genre_confidence)})</Button>
          </form>
        )}
        {t.needs_review && (
          <form action={markReviewed.bind(null, id)}>
            <Button size="sm" variant="outline" type="submit">Mark reviewed</Button>
          </form>
        )}
        {t.bpm != null && (
          <>
            <form action={halveBpm.bind(null, id)}>
              <Button size="sm" variant="outline" type="submit">BPM ÷2 ({(Number(t.bpm) / 2).toFixed(1)})</Button>
            </form>
            <form action={doubleBpm.bind(null, id)}>
              <Button size="sm" variant="outline" type="submit">BPM ×2 ({(Number(t.bpm) * 2).toFixed(1)})</Button>
            </form>
          </>
        )}
      </div>

      <form action={save} className="grid grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
        <label htmlFor="title">Title</label>
        <Input id="title" name="title" defaultValue={t.title} required maxLength={500} />
        <label htmlFor="artist">Artist</label>
        <Input id="artist" name="artist" defaultValue={t.artist ?? ""} maxLength={500} />
        <label htmlFor="source">Source</label>
        <Select id="source" name="source" defaultValue={t.source}>
          {SOURCES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </Select>
        <label htmlFor="genre_id">Genre</label>
        <div className="flex items-center gap-2">
          <Select id="genre_id" name="genre_id" defaultValue={t.genre_id ?? ""}>
            <option value="">None</option>
            {tops.map((g) => (
              <optgroup key={g.id} label={g.name}>
                <option value={g.id}>{g.name}</option>
                {subs(g.id).map((s) => <option key={s.id} value={s.id}>{g.name} › {s.name}</option>)}
              </optgroup>
            ))}
          </Select>
          <span className="text-muted-foreground">{source(t.genre_source, t.genre_confidence)}</span>
        </div>
        <label>Style</label>
        <div className="flex flex-wrap gap-3">
          {(tags ?? []).map((s) => (
            <label key={s.id} className="flex items-center gap-1">
              <input type="checkbox" name="style_tag" value={s.id} defaultChecked={tagged.has(s.id)} /> {s.name}
            </label>
          ))}
        </div>
        <label htmlFor="bpm">BPM</label>
        <div className="flex items-center gap-2">
          <Input id="bpm" name="bpm" type="number" step="0.01" min="1" max="399" defaultValue={t.bpm ?? ""} className="w-28" />
          <span className="text-muted-foreground">{source(t.bpm_source, t.bpm_confidence)}</span>
        </div>
        <label htmlFor="musical_key">Key</label>
        <div className="flex items-center gap-2">
          <Select id="musical_key" name="musical_key" defaultValue={t.musical_key ?? ""}>
            <option value="">Unknown</option>
            {ALL_KEYS.map((k) => <option key={k} value={k}>{k} · {notation(k)}</option>)}
            <option value="atonal">atonal</option>
          </Select>
          <span className="text-muted-foreground">{source(t.key_source, t.key_confidence)}</span>
        </div>
        <label htmlFor="energy">Energy</label>
        <Input id="energy" name="energy" type="number" min="1" max="10" defaultValue={t.energy ?? ""} className="w-20" />
        <label htmlFor="rating">Rating</label>
        <Select id="rating" name="rating" defaultValue={t.rating ?? ""}>
          <option value="">None</option>
          {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{"★".repeat(r)}</option>)}
        </Select>
        <label htmlFor="labels">Labels</label>
        <Input id="labels" name="labels" defaultValue={(t.labels ?? []).join(", ")} placeholder="comma separated, e.g. wip, gig" />
        <label htmlFor="notes" className="self-start pt-2">Notes</label>
        <textarea id="notes" name="notes" defaultValue={t.notes ?? ""} rows={4} maxLength={20000}
          className="rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <span />
        <div><Button type="submit">Save</Button></div>
      </form>

      <section className="space-y-2">
        <h2 className="font-medium">Files</h2>
        <ul className="space-y-1 text-sm">
          {versions.map((v) => (
            <li key={v.id}>
              <span className="font-medium">{v.name}</span>{" "}
              <span className="text-muted-foreground">
                {[v.codec, v.bitrate_kbps && `${v.bitrate_kbps} kbps`, v.sample_rate && `${v.sample_rate / 1000} kHz`,
                  v.bit_depth && `${v.bit_depth} bit`, fmtTime(v.duration_s)].filter(Boolean).join(" · ")}
              </span>
              {v.suspected_fake_lossless && <Badge className="ml-2 border-red-600 text-red-600">fake lossless?</Badge>}
              <div className="text-xs text-muted-foreground">{v.path_hint}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">History</h2>
        <ul className="space-y-1 text-sm">
          {(history ?? []).map((h) => (
            <li key={h.id}>
              <span className="text-muted-foreground">{new Date(h.at).toLocaleString("en-GB")}</span>{" "}
              {who.get(h.actor) ?? "system"}{h.via !== "app" ? ` via ${h.via}` : ""}: {h.op === "update"
                ? Object.keys(h.diff ?? {}).filter((k) => !k.endsWith("_confidence")).join(", ")
                : h.op}
            </li>
          ))}
        </ul>
      </section>
    </div>
    </PlayerProvider>
  );
}
