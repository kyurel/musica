// Crate helpers. Pure, so they are unit-tested.

export class CrateError extends Error {}

export function crateName(v: FormDataEntryValue | null): string {
  const name = (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 200) throw new CrateError("Crate name must be 1 to 200 characters");
  return name;
}

/** New positions after moving one track up or down. Only rows whose position changes. */
export function move(order: string[], trackId: string, dir: -1 | 1): { track_id: string; position: number }[] {
  const i = order.indexOf(trackId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return [];
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((track_id, position) => ({ track_id, position })).filter((r) => order[r.position] !== r.track_id);
}
