// Turns raw MIDI bytes into signal updates. Pure, so it can be tested without a
// controller. Naming is generic on purpose: every knob, fader and pad of any
// controller (DDJ-FLX4, Akai MPK, whatever the DJ has) becomes a signal with no
// setup. Friendly names ("crossfader", "pad 1") come from the learn tool later.

export type MidiUpdate =
  | { kind: "value"; name: string; value: number }
  | { kind: "trigger"; name: string; strength: number };

export interface MidiMessage {
  type: "noteon" | "noteoff" | "cc" | "pitchbend" | "other";
  channel: number; // 1..16
  data1: number;
  data2: number;
}

/** "DDJ-FLX4 MIDI 1" -> "ddj-flx4-midi-1" */
export function deviceSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device"
  );
}

export function parseMidi(bytes: ArrayLike<number>): MidiMessage | null {
  const status = bytes[0];
  if (status === undefined || status < 0x80 || status >= 0xf0) return null; // ignore clock/sysex
  const data1 = bytes[1] ?? 0;
  const data2 = bytes[2] ?? 0;
  const channel = (status & 0x0f) + 1;
  switch (status & 0xf0) {
    case 0x90:
      // Note-on with velocity 0 is a note-off by convention.
      return { type: data2 === 0 ? "noteoff" : "noteon", channel, data1, data2 };
    case 0x80:
      return { type: "noteoff", channel, data1, data2 };
    case 0xb0:
      return { type: "cc", channel, data1, data2 };
    case 0xe0:
      return { type: "pitchbend", channel, data1, data2 };
    default:
      return { type: "other", channel, data1, data2 };
  }
}

/** Signal updates for one message from a device. */
export function midiToSignals(device: string, msg: MidiMessage): MidiUpdate[] {
  const base = `midi.${device}.ch${msg.channel}`;
  switch (msg.type) {
    case "cc":
      return [{ kind: "value", name: `${base}.cc${msg.data1}`, value: msg.data2 / 127 }];
    case "noteon":
      return [
        { kind: "value", name: `${base}.note${msg.data1}`, value: msg.data2 / 127 },
        { kind: "trigger", name: `${base}.note${msg.data1}.on`, strength: msg.data2 / 127 },
      ];
    case "noteoff":
      return [{ kind: "value", name: `${base}.note${msg.data1}`, value: 0 }];
    case "pitchbend":
      return [{ kind: "value", name: `${base}.pitch`, value: ((msg.data2 << 7) | msg.data1) / 16383 }];
    default:
      return [];
  }
}
