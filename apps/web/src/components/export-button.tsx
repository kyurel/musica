"use client";

import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KEY = "musica.libraryRoot";

/** Downloads the current filtered view as M3U8. Each Mac remembers its own library folder. */
export function ExportButton({ query }: { query: string }) {
  const [root, setRoot] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) ?? "";
      setRoot(saved);
      setEditing(!saved);
    } catch {
      setEditing(true);
    }
  }, []);

  const valid = root.trim().startsWith("/");
  const href = () => {
    const q = new URLSearchParams(query);
    q.delete("page");
    q.set("root", root.trim());
    return `/api/export/m3u8?${q}`;
  };

  function save() {
    try {
      localStorage.setItem(KEY, root.trim());
    } catch {
      // private window: keep it for this page only
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Input
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          placeholder="Library folder on this Mac, e.g. /Users/you/Music/Musica"
          className="w-96"
          aria-label="Library folder on this Mac"
        />
        <Button type="button" size="sm" variant="outline" disabled={!valid} onClick={save}>Save</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <a href={href()} download className={buttonVariants({ variant: "outline", size: "sm" })}>Export M3U8</a>
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)} title={root}>
        change folder
      </button>
    </div>
  );
}
