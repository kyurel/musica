"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // e.g. a GitHub account that is not on the allowlist
    setError(new URLSearchParams(window.location.search).get("error"));
  }, []);

  async function signIn() {
    setBusy(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-4 text-center">
      <h1 className="text-2xl font-semibold">Musica</h1>
      <p className="text-sm text-muted-foreground">Our shared music library. Members only.</p>
      <Button onClick={signIn} disabled={busy} className="w-full">Sign in with GitHub</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
