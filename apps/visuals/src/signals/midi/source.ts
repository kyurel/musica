// Web MIDI wiring. On macOS several apps can listen to the same controller at
// once, so rekordbox keeps working while we read the FLX4 alongside it.

import type { SignalBus } from "../bus";
import { deviceSlug, midiToSignals, parseMidi } from "./parse";

export interface MidiLogEntry {
  at: number;
  device: string;
  text: string;
}

export class MidiSource {
  private access: MIDIAccess | null = null;
  readonly log: MidiLogEntry[] = [];
  error = "";

  constructor(private readonly bus: SignalBus) {}

  get devices(): string[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => i.name ?? "Unknown");
  }

  async start(): Promise<void> {
    if (!("requestMIDIAccess" in navigator)) {
      this.error = "This browser has no Web MIDI. Use Chrome.";
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      this.error = `MIDI permission refused: ${String(e)}`;
      return;
    }
    const attach = () => {
      for (const input of this.access!.inputs.values()) {
        input.onmidimessage = (ev) => this.handle(input.name ?? "unknown", ev.data);
      }
    };
    attach();
    this.access.onstatechange = attach; // controllers plugged in later
  }

  private handle(deviceName: string, data: Uint8Array | null): void {
    if (!data) return;
    const msg = parseMidi(data);
    if (!msg || msg.type === "other") return;
    const device = deviceSlug(deviceName);
    for (const u of midiToSignals(device, msg)) {
      if (u.kind === "value") this.bus.set(u.name, u.value);
      else this.bus.fire(u.name, u.strength);
    }
    this.log.unshift({
      at: performance.now(),
      device: deviceName,
      text: `${msg.type} ch${msg.channel} ${msg.data1} ${msg.data2}`,
    });
    if (this.log.length > 30) this.log.length = 30;
  }
}
