import { createClient as createSupabase } from "@supabase/supabase-js";

/** Supabase client acting as the caller of an API route that sent a bearer token (the worker). */
export function clientFromBearer(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}`, "x-musica-via": "worker" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
