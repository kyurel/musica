import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NotMember } from "@/components/not-member";
import { createClient } from "@/lib/supabase/server";
import { createCrate } from "./actions";

export const dynamic = "force-dynamic";

export default async function CratesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const db = await createClient();
  const { data: member } = await db.rpc("is_member");
  if (!member) return <NotMember />;
  const sp = await searchParams;
  const { data: crates } = await db.from("crates").select("id, name, updated_at, crate_tracks(count)")
    .is("deleted_at", null).order("name");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Crates</h1>
      {sp.error && <p className="rounded-md border border-red-600 p-3 text-sm text-red-600">{sp.error}</p>}
      <form action={createCrate} className="flex items-center gap-2">
        <Input name="name" placeholder="New crate name" className="w-72" required maxLength={200} />
        <Button type="submit" size="sm">Create</Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Name</TableHead><TableHead className="text-right">Tracks</TableHead><TableHead>Changed</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {(crates ?? []).length === 0 && (
            <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No crates yet.</TableCell></TableRow>
          )}
          {(crates ?? []).map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium"><Link href={`/crates/${c.id}`} className="hover:underline">{c.name}</Link></TableCell>
              <TableCell className="text-right tabular-nums">{(c.crate_tracks as unknown as { count: number }[])?.[0]?.count ?? 0}</TableCell>
              <TableCell className="text-muted-foreground">{new Date(c.updated_at).toLocaleDateString("en-GB")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
