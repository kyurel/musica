import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NotMember } from "@/components/not-member";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ONLINE_MS = 3 * 60 * 1000;

export default async function SystemPage() {
  const supabase = await createClient();
  const { data: member } = await supabase.rpc("is_member");
  if (!member) return <NotMember />;

  const [{ data: runners, error: runnersError }, { data: jobs, error: jobsError }] = await Promise.all([
    supabase.from("runners").select("name, capabilities, last_heartbeat").order("name"),
    supabase.from("jobs").select("id, kind, status, attempts, claimed_by, error, created_at, capabilities")
      .in("status", ["queued", "running", "failed"]).order("created_at", { ascending: false }).limit(100),
  ]);

  const now = Date.now();
  const online = (runners ?? []).filter((r) => now - new Date(r.last_heartbeat).getTime() < ONLINE_MS);
  const queued = (jobs ?? []).filter((j) => j.status === "queued");

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">System status</h1>

      {(runnersError || jobsError) && (
        <p className="rounded-md border border-destructive p-3 text-sm text-destructive">
          Couldn&apos;t load status: {(runnersError ?? jobsError)?.message}
        </p>
      )}

      {online.length === 0 && queued.length > 0 && (
        <p className="rounded-md border p-3 text-sm">
          No Mac is running the worker right now. {queued.length} job{queued.length === 1 ? "" : "s"} will wait until one is on.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Macs</h2>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Can do</TableHead><TableHead>Last seen</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(runners ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  No Mac has connected yet. Set up the worker on a Mac (<code>musica-worker login</code>, then{" "}
                  <code>musica-worker service install</code>, see docs/DEPLOY.md) and it shows up here.
                </TableCell>
              </TableRow>
            )}
            {(runners ?? []).map((r) => {
              const up = online.includes(r);
              return (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge className={up ? "border-green-600 text-green-600" : ""}>{up ? "online" : "offline"}</Badge></TableCell>
                  <TableCell className="space-x-1">{r.capabilities.map((c: string) => <Badge key={c}>{c}</Badge>)}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.last_heartbeat).toLocaleString("en-GB")}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Jobs</h2>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Kind</TableHead><TableHead>Status</TableHead><TableHead>Mac</TableHead><TableHead>Tries</TableHead><TableHead>Error</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(jobs ?? []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Nothing queued.</TableCell></TableRow>
            )}
            {(jobs ?? []).map((j) => (
              <TableRow key={j.id}>
                <TableCell>{j.kind}</TableCell>
                <TableCell><Badge className={j.status === "failed" ? "border-destructive text-destructive" : ""}>{j.status}</Badge></TableCell>
                <TableCell>{j.claimed_by}</TableCell>
                <TableCell>{j.attempts}</TableCell>
                <TableCell className="max-w-sm truncate text-muted-foreground" title={j.error ?? undefined}>{j.error}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
