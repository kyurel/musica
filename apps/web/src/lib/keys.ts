// Camelot <-> musical notation. Keys are stored as Camelot codes ("8A") or "atonal".
// Mirrors worker/src/musica_worker/keys.py.

export const PITCHES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
export const ATONAL = "atonal";

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function parseCamelot(code: string): { num: number; minor: boolean } | null {
  const m = /^(1[0-2]|[1-9])([AB])$/i.exec(code.trim());
  return m ? { num: Number(m[1]), minor: m[2].toUpperCase() === "A" } : null;
}

export function notation(code: string | null | undefined): string {
  if (!code) return "";
  if (code === ATONAL) return "atonal";
  const c = parseCamelot(code);
  if (!c) return code;
  const majorPc = mod(7 * (c.num - 8), 12);
  const pc = c.minor ? mod(majorPc - 3, 12) : majorPc;
  return `${PITCHES[pc]} ${c.minor ? "minor" : "major"}`;
}

/** Keys that mix harmonically with this one: same, one step either way, and the relative key. */
export function compatibleKeys(code: string): string[] {
  const c = parseCamelot(code);
  if (!c) return code === ATONAL ? [ATONAL] : [];
  const letter = c.minor ? "A" : "B";
  const other = c.minor ? "B" : "A";
  const step = (d: number) => mod(c.num - 1 + d, 12) + 1;
  return [`${c.num}${letter}`, `${step(1)}${letter}`, `${step(-1)}${letter}`, `${c.num}${other}`];
}

export const ALL_KEYS = Array.from({ length: 12 }, (_, i) => [`${i + 1}A`, `${i + 1}B`]).flat();
