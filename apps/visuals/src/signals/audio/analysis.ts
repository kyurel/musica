// Pure audio analysis: no Web Audio here, just numbers in and numbers out, so
// every piece can be tested with synthetic input. `source.ts` feeds it from the
// microphone / BlackHole input each animation frame.
//
// Times are in seconds. Spectra are linear magnitudes (not dB), one per FFT bin.

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Exponential smoothing factor for a time constant `tau` over a step `dt`. */
export const emaAlpha = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

export interface Band {
  name: string;
  lowHz: number;
  highHz: number;
}

export const DEFAULT_BANDS: readonly Band[] = [
  { name: "bass", lowHz: 30, highHz: 150 },
  { name: "mid", lowHz: 150, highHz: 2000 },
  { name: "high", lowHz: 2000, highHz: 12000 },
];

/** Bins [first, last] (inclusive) covering a frequency range. */
export function bandBins(binHz: number, binCount: number, lowHz: number, highHz: number): [number, number] {
  const first = Math.max(1, Math.floor(lowHz / binHz));
  const last = Math.min(binCount - 1, Math.max(first, Math.ceil(highHz / binHz) - 1));
  return [first, last];
}

/** Root-mean-square magnitude inside a frequency range. */
export function bandEnergy(mags: ArrayLike<number>, binHz: number, lowHz: number, highHz: number): number {
  const [first, last] = bandBins(binHz, mags.length, lowHz, highHz);
  let sum = 0;
  for (let i = first; i <= last; i++) {
    const m = mags[i] ?? 0;
    sum += m * m;
  }
  return Math.sqrt(sum / (last - first + 1));
}

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Auto-gain: divides by a slowly decaying recent peak, so a quiet bedroom and a
 * loud club both produce values that use the whole 0..1 range. This is the
 * "loudness calibration" an event profile will tune later (half-life, floor).
 */
export class AutoGain {
  private peak = 0;

  constructor(
    private readonly halfLife = 8,
    /** Below this raw level we treat input as silence instead of boosting noise. */
    private readonly floor = 1e-4,
  ) {}

  process(x: number, dt: number): number {
    this.peak = Math.max(x, this.peak * Math.pow(0.5, dt / this.halfLife), this.floor);
    return clamp01(x / this.peak);
  }
}

/**
 * Detects onsets (mostly kick drums) from spectral flux in the bass range: how
 * much louder the bass bins got since the last frame, compared with the recent
 * average. A refractory period stops one kick firing twice.
 */
export class OnsetDetector {
  private readonly history: { t: number; flux: number }[] = [];
  private lastOnset = -Infinity;

  constructor(
    private readonly sensitivity = 1.5,
    private readonly windowSec = 1.5,
    private readonly refractorySec = 0.28,
  ) {}

  /** Returns true when an onset happens at time `t`. */
  process(flux: number, t: number): boolean {
    while (this.history.length > 0 && this.history[0]!.t < t - this.windowSec) this.history.shift();
    let mean = 0;
    for (const h of this.history) mean += h.flux;
    mean = this.history.length > 0 ? mean / this.history.length : 0;
    let variance = 0;
    for (const h of this.history) variance += (h.flux - mean) ** 2;
    const std = this.history.length > 1 ? Math.sqrt(variance / this.history.length) : 0;
    this.history.push({ t, flux });

    const threshold = mean + this.sensitivity * std;
    const warmedUp = this.history.length >= 8;
    if (warmedUp && flux > threshold && flux > 1e-6 && t - this.lastOnset >= this.refractorySec) {
      this.lastOnset = t;
      return true;
    }
    return false;
  }
}

export interface TempoEstimate {
  bpm: number;
  /** 0..1: how much of the onset evidence agrees with this tempo. */
  confidence: number;
}

/**
 * Estimates BPM from recent onset times: picks the tempo whose beat grid best
 * explains the gaps between onsets, within one octave (85-170 BPM by default,
 * so 174 drum & bass reads as 87 and half/double time never fight).
 */
export class TempoEstimator {
  private readonly onsets: number[] = [];
  private current: TempoEstimate = { bpm: 0, confidence: 0 };
  private lastOnset = -Infinity;

  constructor(
    private readonly minBpm = 85,
    private readonly maxBpm = 170,
    private readonly windowSec = 8,
  ) {}

  addOnset(t: number): void {
    this.onsets.push(t);
    this.lastOnset = t;
    while (this.onsets.length > 0 && this.onsets[0]! < t - this.windowSec) this.onsets.shift();
    this.current = this.estimate();
  }

  get estimateNow(): TempoEstimate {
    return this.current;
  }

  /** 0..1 position inside the current beat, 0 at the last onset. 0 if tempo unknown. */
  phase(t: number): number {
    if (this.current.bpm <= 0 || !Number.isFinite(this.lastOnset)) return 0;
    const period = 60 / this.current.bpm;
    const p = ((t - this.lastOnset) / period) % 1;
    return p < 0 ? p + 1 : p;
  }

  /** How well a beat period explains the onset gaps: each gap scores by how close it is to a whole number of beats. */
  private score(gaps: readonly number[], period: number, tolerance: number): { score: number; fits: number } {
    let score = 0;
    let fits = 0;
    for (const gap of gaps) {
      const beats = Math.round(gap / period);
      if (beats < 1) continue;
      const err = Math.abs(gap - beats * period);
      score += Math.exp(-((err / tolerance) ** 2));
      if (err < tolerance * 1.5) fits++;
    }
    return { score, fits };
  }

  private estimate(): TempoEstimate {
    // Gaps between every pair of onsets up to 2.5 s apart (so off-beats and missed kicks still help).
    const gaps: number[] = [];
    for (let i = 0; i < this.onsets.length; i++) {
      for (let j = i + 1; j < this.onsets.length; j++) {
        const gap = this.onsets[j]! - this.onsets[i]!;
        if (gap > 2.5) break;
        if (gap >= 0.2) gaps.push(gap);
      }
    }
    if (gaps.length < 3) return this.current;

    // Try every tempo in the range (coarse, then fine around the winner).
    // The range is one octave wide, so half/double time can't both compete.
    const tolerance = 0.02; // seconds: covers 60 fps frame jitter
    let best = this.minBpm;
    let bestScore = -1;
    for (let bpm = this.minBpm; bpm < this.maxBpm; bpm += 0.25) {
      const { score } = this.score(gaps, 60 / bpm, tolerance);
      if (score > bestScore) {
        bestScore = score;
        best = bpm;
      }
    }
    const coarse = best;
    for (let bpm = coarse - 0.3; bpm <= coarse + 0.3; bpm += 0.02) {
      const { score } = this.score(gaps, 60 / bpm, tolerance);
      if (score > bestScore) {
        bestScore = score;
        best = bpm;
      }
    }
    const confidence = clamp01(this.score(gaps, 60 / best, tolerance).fits / gaps.length);

    // Hold a tempo steady unless the new one clearly disagrees.
    const prev = this.current;
    if (prev.bpm > 0 && Math.abs(best - prev.bpm) / prev.bpm < 0.03) {
      return { bpm: prev.bpm * 0.7 + best * 0.3, confidence };
    }
    return { bpm: best, confidence };
  }
}

export interface DropState {
  /** True while the bass has fallen well below the track's normal level. */
  breakdown: boolean;
  /** True on the single frame where the bass comes back after a breakdown. */
  drop: boolean;
}

/**
 * Detects the classic breakdown → drop shape from the raw (not auto-gained) bass
 * level: the bass falls well under its usual level for a while, then returns.
 */
export class DropDetector {
  private short = 0;
  private body = 0;
  private quietFor = 0;
  private loudFor = 0;
  private inBreakdown = false;

  constructor(
    private readonly enterRatio = 0.35,
    private readonly dropRatio = 0.75,
    private readonly minBreakdownSec = 2,
    private readonly warmupSec = 4,
  ) {}

  process(bass: number, dt: number): DropState {
    this.short += (bass - this.short) * emaAlpha(dt, 0.25);
    if (this.inBreakdown) {
      if (this.short > this.dropRatio * this.body) {
        this.inBreakdown = false;
        this.quietFor = 0;
        return { breakdown: false, drop: true };
      }
      return { breakdown: true, drop: false };
    }

    if (this.loudFor >= this.warmupSec && this.short < this.enterRatio * this.body) {
      this.quietFor += dt;
      if (this.quietFor >= this.minBreakdownSec) this.inBreakdown = true;
    } else {
      this.quietFor = 0;
      // Only learn the "normal" level from the full-energy parts of the track.
      this.body += (this.short - this.body) * emaAlpha(dt, 6);
      if (this.short > 1e-4) this.loudFor += dt;
    }
    return { breakdown: this.inBreakdown, drop: false };
  }
}

export interface AudioFrame {
  level: number;
  bands: Record<string, number>;
  beat: boolean;
  bpm: number;
  bpmConfidence: number;
  beatPhase: number;
  breakdown: boolean;
  drop: boolean;
}

/** Ties the pieces together. Call `process` once per analysis frame. */
export class AudioAnalyzer {
  private readonly levelGain = new AutoGain();
  private readonly bandGains = new Map<string, AutoGain>();
  private readonly onsets = new OnsetDetector();
  private readonly tempo = new TempoEstimator();
  private readonly drops = new DropDetector();
  private prevBass: Float64Array | null = null;
  private lastT: number | null = null;

  constructor(
    private readonly binHz: number,
    private readonly bands: readonly Band[] = DEFAULT_BANDS,
  ) {
    for (const b of bands) this.bandGains.set(b.name, new AutoGain());
  }

  process(mags: ArrayLike<number>, samples: ArrayLike<number>, t: number): AudioFrame {
    const dt = this.lastT === null ? 1 / 60 : Math.max(1e-3, t - this.lastT);
    this.lastT = t;

    const bands: Record<string, number> = {};
    let rawBass = 0;
    for (const b of this.bands) {
      const e = bandEnergy(mags, this.binHz, b.lowHz, b.highHz);
      if (b.name === "bass") rawBass = e;
      bands[b.name] = this.bandGains.get(b.name)!.process(e, dt);
    }

    // Spectral flux over the bass bins, on log-compressed magnitudes.
    const [first, last] = bandBins(this.binHz, mags.length, 30, 150);
    const n = last - first + 1;
    if (!this.prevBass || this.prevBass.length !== n) this.prevBass = new Float64Array(n);
    let flux = 0;
    for (let i = 0; i < n; i++) {
      const m = Math.log1p(1000 * (mags[first + i] ?? 0));
      const d = m - this.prevBass[i]!;
      if (d > 0) flux += d;
      this.prevBass[i] = m;
    }

    const beat = this.onsets.process(flux, t);
    if (beat) this.tempo.addOnset(t);
    const { bpm, confidence } = this.tempo.estimateNow;
    const drop = this.drops.process(rawBass, dt);

    return {
      level: this.levelGain.process(rms(samples), dt),
      bands,
      beat,
      bpm,
      bpmConfidence: confidence,
      beatPhase: this.tempo.phase(t),
      breakdown: drop.breakdown,
      drop: drop.drop,
    };
  }
}
