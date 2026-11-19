import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client for server components and route handlers, signed in as the visitor. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { "x-musica-via": "app" } },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from a server component: the middleware refreshes cookies instead
          }
        },
      },
    },
  );
}
