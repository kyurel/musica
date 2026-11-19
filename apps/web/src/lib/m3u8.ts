// Extended M3U, UTF-8 (.m3u8). Read by Rekordbox, Traktor, Serato, VLC, Music.
// Mirrors worker/src/musica_worker/exporters/m3u8.py; both are checked against
// testdata/golden/. Titles and artists are untrusted: control characters (line breaks
// included) are replaced, so a title can never add a line, and so a path, to the file.

export type Entry = { path: string; title: string; artist?: string | null; duration_s?: number | null };
export type Playlist = { name: string; entries: Entry[] };

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

export const clean = (text: string | null | undefined) => (text ?? "").replace(CONTROL, " ").trim();

function seconds(d: number | null | undefined) {
  return d == null || !Number.isFinite(d) || d < 0 ? -1 : Math.floor(d + 0.5);
}

function pathLine(path: string): string | null {
  if (!path || new RegExp(CONTROL.source).test(path)) return null;
  return path.startsWith("#") ? `./${path}` : path;
}

export function renderM3u8(playlist: Playlist): string {
  const lines = ["#EXTM3U", `#PLAYLIST:${clean(playlist.name)}`];
  for (const e of playlist.entries) {
    const path = pathLine(e.path);
    if (path === null) continue;
    const artist = clean(e.artist);
    const title = clean(e.title);
    lines.push(`#EXTINF:${seconds(e.duration_s)},${artist ? `${artist} - ${title}` : title}`);
    lines.push(path);
  }
  return lines.join("\n") + "\n";
}

/** File name for the download: no path separators or characters macOS Finder dislikes. */
export function safeFilename(name: string) {
  const s = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");
  return (s || "playlist").slice(0, 120);
}

/** Absolute path on this Mac: the library folder plus the file's path inside it. */
export function joinRoot(root: string, pathHint: string) {
  return `${root.replace(/\/+$/, "")}/${pathHint.replace(/^\/+/, "")}`;
}
