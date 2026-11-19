// Level-matched playback: every preview plays at the same perceived loudness,
// so A/B comparisons are not won by the louder track.
export const TARGET_LUFS = -14;
const MAX_BOOST_DB = 12;

export function matchGain(lufs: number | null | undefined, target = TARGET_LUFS): number {
  if (lufs == null || !Number.isFinite(lufs)) return 1;
  const db = Math.min(MAX_BOOST_DB, target - lufs);
  return Math.pow(10, db / 20);
}
