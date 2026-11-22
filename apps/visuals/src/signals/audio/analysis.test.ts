import { describe, expect, it } from "vitest";
import {
  AudioAnalyzer,
  AutoGain,
  DropDetector,
  OnsetDetector,
  TempoEstimator,
  bandEnergy,
  rms,
} from "./analysis";

const FPS = 60;
const DT = 1 / FPS;
const BIN_HZ = 48000 / 2048;
const BINS = 1024;

/** A spectrum with a given magnitude in the bass bins and a quieter rest. */
function spectrum(bass: number, rest = 0.01): Float32Array {
  const m = new Float32Array(BINS).fill(rest);
  for (let i = 1; i * BIN_HZ < 150; i++) m[i] = bass;
  return m;
}

/** Bass envelope for a four-on-the-floor kick at `bpm`: a sharp hit decaying fast. */
function kickLevel(t: number, bpm: number, loud = 1): number {
  const period = 60 / bpm;
  const sinceKick = t % period;
  return loud * (0.05 + Math.exp(-sinceKick / 0.06));
}

describe("helpers", () => {
  it("measures band energy and RMS", () => {
    expect(bandEnergy(spectrum(0.5), BIN_HZ, 30, 150)).toBeCloseTo(0.5);
    expect(bandEnergy(spectrum(0.5), BIN_HZ, 2000, 12000)).toBeCloseTo(0.01);
    expect(rms([1, -1, 1, -1])).toBe(1);
    expect(rms([])).toBe(0);
  });
});

describe("AutoGain", () => {
  it("makes quiet and loud input use the same range", () => {
    const quiet = new AutoGain();
    const loud = new AutoGain();
    let q = 0;
    let l = 0;
    for (let i = 0; i < 300; i++) {
      const wave = 0.5 + 0.5 * Math.sin(i / 5);
      q = quiet.process(0.01 * wave, DT);
      l = loud.process(0.8 * wave, DT);
    }
    expect(q).toBeCloseTo(l, 2);
  });

  it("does not boost silence into noise", () => {
    const g = new AutoGain(8, 1e-3);
    for (let i = 0; i < 600; i++) g.process(0, DT);
    expect(g.process(1e-5, DT)).toBeLessThan(0.02);
  });
});

describe("OnsetDetector + TempoEstimator", () => {
  it.each([120, 128, 140])("finds every kick and the tempo at %i BPM", (bpm) => {
    const onsets = new OnsetDetector();
    const tempo = new TempoEstimator();
    let prev = 0;
    let count = 0;
    const seconds = 10;
    for (let i = 0; i < seconds * FPS; i++) {
      const t = i * DT;
      const level = kickLevel(t, bpm);
      const flux = Math.max(0, level - prev);
      prev = level;
      if (onsets.process(flux, t)) {
        tempo.addOnset(t);
        count++;
      }
    }
    const expectedKicks = (seconds * bpm) / 60;
    expect(count).toBeGreaterThan(expectedKicks - 3); // first few frames are warm-up
    expect(count).toBeLessThanOrEqual(expectedKicks + 1);
    // 60 fps frames quantize onsets to ~17 ms, so allow ~1.5 BPM.
    expect(tempo.estimateNow.bpm).toBeGreaterThan(bpm - 1.5);
    expect(tempo.estimateNow.bpm).toBeLessThan(bpm + 1.5);
    expect(tempo.estimateNow.confidence).toBeGreaterThan(0.5);
  });

  it("folds drum & bass at 174 into one octave below the range limit", () => {
    const tempo = new TempoEstimator();
    for (let i = 0; i < 20; i++) tempo.addOnset((i * 60) / 174);
    expect(tempo.estimateNow.bpm).toBeCloseTo(87, 0);
  });

  it("keeps the tempo through missed kicks and off-beat hits", () => {
    const tempo = new TempoEstimator();
    const period = 60 / 128;
    for (let i = 0; i < 16; i++) {
      if (i % 7 !== 3) tempo.addOnset(i * period); // some kicks missed
      if (i % 4 === 1) tempo.addOnset(i * period + period / 2); // an off-beat clap
    }
    expect(tempo.estimateNow.bpm).toBeCloseTo(128, 0);
  });

  it("reports beat phase from the last onset", () => {
    const tempo = new TempoEstimator();
    for (let i = 0; i < 16; i++) tempo.addOnset(i * 0.5); // 120 BPM
    expect(tempo.phase(7.5)).toBeCloseTo(0, 1);
    expect(tempo.phase(7.75)).toBeCloseTo(0.5, 1);
  });
});

describe("DropDetector", () => {
  it("sees a breakdown and fires once when the bass comes back", () => {
    const d = new DropDetector();
    const states: string[] = [];
    const run = (seconds: number, bass: number) => {
      for (let i = 0; i < seconds * FPS; i++) {
        const s = d.process(bass, DT);
        if (s.drop) states.push("drop");
        else if (s.breakdown && states.at(-1) !== "breakdown") states.push("breakdown");
      }
    };
    run(16, 1); // groove
    run(8, 0.1); // breakdown: bass gone
    run(4, 1); // drop
    expect(states).toEqual(["breakdown", "drop"]);
  });

  it("ignores short gaps in the bass", () => {
    const d = new DropDetector();
    let fired = false;
    const run = (seconds: number, bass: number) => {
      for (let i = 0; i < seconds * FPS; i++) fired ||= d.process(bass, DT).drop;
    };
    run(16, 1);
    run(1, 0.05); // a one-second gap is not a breakdown
    run(4, 1);
    expect(fired).toBe(false);
  });
});

describe("AudioAnalyzer", () => {
  it("goes from spectra to beats, tempo and a drop", () => {
    const a = new AudioAnalyzer(BIN_HZ);
    const samples = new Float32Array(2048);
    let beats = 0;
    let drops = 0;
    let breakdownSeen = false;
    let lastBpm = 0;
    const play = (from: number, to: number, loud: number) => {
      for (let t = from; t < to; t += DT) {
        const f = a.process(spectrum(kickLevel(t, 126, loud)), samples, t);
        if (f.beat) beats++;
        if (f.drop) drops++;
        breakdownSeen ||= f.breakdown;
        lastBpm = f.bpm;
      }
    };
    play(0, 16, 1);
    const beatsBeforeBreakdown = beats;
    play(16, 24, 0.03);
    play(24, 30, 1);

    expect(beatsBeforeBreakdown).toBeGreaterThan(28);
    expect(lastBpm).toBeGreaterThan(124.5);
    expect(lastBpm).toBeLessThan(127.5);
    expect(breakdownSeen).toBe(true);
    expect(drops).toBe(1);
  });
});
