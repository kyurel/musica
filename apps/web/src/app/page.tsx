import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { NotMember } from "@/components/not-member";
import { STATUS_LABEL, TOOLS, type Tool } from "@/lib/tools";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Library filters used to live on "/". Old bookmarks and links still work.
const LIBRARY_PARAMS = ["q", "genre", "bpm_min", "bpm_max", "key", "mixable", "source", "review", "page"];

export default async function HomePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  if (LIBRARY_PARAMS.some((k) => k in sp)) {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
    redirect(`/library?${q}`);
  }

  const supabase = await createClient();
  const { data: member } = await supabase.rpc("is_member");
  if (!member) return <NotMember />;

  const [{ count: tracks }, { count: review }] = await Promise.all([
    supabase.from("tracks").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("tracks").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("needs_review", true),
  ]);

  const [library, ...rest] = TOOLS;
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Musica</h1>
        <p className="text-muted-foreground">Our studio tools around one shared library. Pick a tool to start.</p>
      </div>

      <ToolCard t={library} big>
        <p className="text-sm text-muted-foreground">
          {tracks ?? 0} tracks{review ? ` · ${review} need review` : ""}
        </p>
      </ToolCard>

      <div className="grid gap-4 sm:grid-cols-2">
        {rest.map((t) => <ToolCard key={t.slug} t={t} />)}
      </div>

      <p className="text-sm text-muted-foreground">
        Worker and storage health is on <Link href="/system" className="underline hover:text-foreground">System status</Link>.
      </p>
    </div>
  );
}

function ToolCard({ t, big, children }: { t: Tool; big?: boolean; children?: React.ReactNode }) {
  const live = t.status === "live";
  return (
    <div
      className={cn(
        "relative rounded-lg border p-5 transition-colors hover:bg-muted/50",
        !live && "border-dashed",
        big && "p-6",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className={cn("font-semibold", big ? "text-xl" : "text-lg")}>
          {/* The title link covers the whole card; sub-links sit above it. */}
          <Link href={t.href} className="after:absolute after:inset-0">{t.name}</Link>
        </h2>
        <Badge className={cn(live ? "border-foreground/30" : "text-muted-foreground")}>{STATUS_LABEL[t.status]}</Badge>
        {!live && <span className="text-xs text-muted-foreground">{t.milestone}</span>}
      </div>
      <p className={cn("text-sm", live ? "text-foreground" : "text-muted-foreground")}>{t.tagline}</p>
      {children && <div className="mt-3">{children}</div>}
      {t.links && (
        <div className="relative mt-3 flex gap-4 text-sm">
          <Link href={t.href} className="underline">Open {t.name}</Link>
          {t.links.map((l) => <Link key={l.href} href={l.href} className="underline">{l.label}</Link>)}
        </div>
      )}
    </div>
  );
}
