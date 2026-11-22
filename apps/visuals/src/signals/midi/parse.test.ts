import { describe, expect, it } from "vitest";
import { deviceSlug, midiToSignals, parseMidi } from "./parse";

describe("MIDI parsing", () => {
  it("slugs device names", () => {
    expect(deviceSlug("DDJ-FLX4")).toBe("ddj-flx4");
    expect(deviceSlug("MPK mini 3 ")).toBe("mpk-mini-3");
    expect(deviceSlug("***")).toBe("device");
  });

  it("turns a control change into a 0..1 value", () => {
    const msg = parseMidi([0xb0, 31, 127])!;
    expect(msg).toEqual({ type: "cc", channel: 1, data1: 31, data2: 127 });
    expect(midiToSignals("ddj-flx4", msg)).toEqual([{ kind: "value", name: "midi.ddj-flx4.ch1.cc31", value: 1 }]);
  });

  it("turns a pad hit into a held value plus a trigger", () => {
    const msg = parseMidi([0x99, 36, 64])!;
    expect(msg.channel).toBe(10);
    const updates = midiToSignals("mpk", msg);
    expect(updates).toEqual([
      { kind: "value", name: "midi.mpk.ch10.note36", value: 64 / 127 },
      { kind: "trigger", name: "midi.mpk.ch10.note36.on", strength: 64 / 127 },
    ]);
  });

  it("treats note-on with velocity 0 as note-off", () => {
    const msg = parseMidi([0x90, 60, 0])!;
    expect(msg.type).toBe("noteoff");
    expect(midiToSignals("x", msg)).toEqual([{ kind: "value", name: "midi.x.ch1.note60", value: 0 }]);
  });

  it("reads 14-bit pitch bend and ignores clock and sysex", () => {
    const msg = parseMidi([0xe0, 0x7f, 0x7f])!;
    expect(midiToSignals("x", msg)[0]).toMatchObject({ name: "midi.x.ch1.pitch", value: 1 });
    expect(parseMidi([0xf8])).toBeNull();
    expect(parseMidi([0xf0, 1, 2])).toBeNull();
    expect(parseMidi([])).toBeNull();
  });
});
