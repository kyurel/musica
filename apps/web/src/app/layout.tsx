import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { TOOLS } from "@/lib/tools";

export const metadata: Metadata = { title: "Musica", description: "Our studio tools around one shared music library" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const login = user?.user_metadata?.user_name as string | undefined;

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {user && (
          <header className="border-b">
            <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
              <Link href="/" className="font-semibold">Musica</Link>
              <Link href="/library" className="text-muted-foreground hover:text-foreground">Library</Link>
              <Link href="/crates" className="text-muted-foreground hover:text-foreground">Crates</Link>
              {TOOLS.filter((t) => t.status !== "live" && t.status !== "later").map((t) => (
                <Link key={t.slug} href={t.href} className="text-muted-foreground hover:text-foreground">{t.name}</Link>
              ))}
              <Link href="/system" className="text-muted-foreground hover:text-foreground">System status</Link>
              <span className="ml-auto text-muted-foreground">{login}</span>
              <form action="/auth/signout" method="post">
                <button className="text-muted-foreground hover:text-foreground">Sign out</button>
              </form>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
