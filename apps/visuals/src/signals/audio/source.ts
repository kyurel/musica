// Web Audio wiring: opens an audio input (BlackHole loopback, an audio interface,
// or the built-in mic), runs the analyser every animation frame and publishes
// the results to the signal bus.

import type { SignalBus } from "../bus";
import { AudioAnalyzer, DEFAULT_BANDS } from "./analysis";

export interface AudioInputDevice {
  id: string;
  label: string;
}

/** Lists audio inputs. Labels are only filled in after mic permission is granted. */
export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
}

export function declareAudioSignals(bus: SignalBus): void {
  bus.declare("audio.level", "value", { label: "Overall loudness (auto-gained)" });
  for (const b of DEFAULT_BANDS) {
    bus.declare(`audio.${b.name}`, "value", { label: `${b.lowHz}-${b.highHz} Hz energy (auto-gained)` });
  }
  bus.declare("audio.beat", "trigger", { label: "Kick / beat onset" });
  bus.declare("audio.bpm", "value", { min: 0, max: 200, label: "Estimated tempo" });
  bus.declare("audio.bpmConfidence", "value", { label: "How sure the tempo estimate is" });
  bus.declare("audio.beatPhase", "value", { label: "Position inside the current beat" });
  bus.declare("audio.breakdown", "value", { label: "1 while the bass is gone (breakdown)" });
  bus.declare("audio.drop", "trigger", { label: "Bass returns after a breakdown" });
}

export class AudioSource {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private analyzer: AudioAnalyzer | null = null;
  private freqDb: Float32Array<ArrayBuffer> = new Float32Array(0);
  private mags: Float32Array = new Float32Array(0);
  private samples: Float32Array<ArrayBuffer> = new Float32Array(0);
  deviceLabel = "";

  constructor(private readonly bus: SignalBus) {
    declareAudioSignals(bus);
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(deviceId?: string): Promise<void> {
    await this.stop();
    // Turn off the browser's voice processing: it would squash the music.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
    });
    this.deviceLabel = this.stream.getAudioTracks()[0]?.label ?? "";
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    const input = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    input.connect(this.analyser); // Not connected to the speakers: analysis only.

    this.freqDb = new Float32Array(this.analyser.frequencyBinCount);
    this.mags = new Float32Array(this.analyser.frequencyBinCount);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.analyzer = new AudioAnalyzer(this.ctx.sampleRate / this.analyser.fftSize);
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.analyzer = null;
  }

  /** Call once per animation frame. */
  update(): void {
    if (!this.ctx || !this.analyser || !this.analyzer) return;
    this.analyser.getFloatFrequencyData(this.freqDb);
    this.analyser.getFloatTimeDomainData(this.samples);
    for (let i = 0; i < this.freqDb.length; i++) {
      const db = this.freqDb[i]!;
      this.mags[i] = Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
    }

    const f = this.analyzer.process(this.mags, this.samples, this.ctx.currentTime);
    const bus = this.bus;
    bus.set("audio.level", f.level);
    for (const [name, v] of Object.entries(f.bands)) bus.set(`audio.${name}`, v);
    bus.set("audio.bpm", f.bpm);
    bus.set("audio.bpmConfidence", f.bpmConfidence);
    bus.set("audio.beatPhase", f.beatPhase);
    bus.set("audio.breakdown", f.breakdown ? 1 : 0);
    if (f.beat) bus.fire("audio.beat", f.bands["bass"] ?? 1);
    if (f.drop) bus.fire("audio.drop");
  }
}
