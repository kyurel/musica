import { describe, expect, it } from "vitest";
import { SignalBus } from "./bus";

describe("SignalBus", () => {
  it("stores values and fires triggers to listeners", () => {
    let t = 0;
    const bus = new SignalBus(() => t);
    const fired: string[] = [];
    bus.onTrigger((name, strength) => fired.push(`${name}:${strength}`));

    t = 10;
    bus.set("audio.bass", 0.4);
    bus.fire("audio.beat", 0.8);
    bus.fire("audio.beat");

    expect(bus.get("audio.bass")).toBe(0.4);
    expect(bus.state("audio.beat")).toMatchObject({ kind: "trigger", count: 2, updatedAt: 10 });
    expect(fired).toEqual(["audio.beat:0.8", "audio.beat:1"]);
  });

  it("returns 0 for unknown signals and replaces NaN with 0", () => {
    const bus = new SignalBus(() => 0);
    expect(bus.get("nope")).toBe(0);
    bus.set("x", Number.NaN);
    expect(bus.get("x")).toBe(0);
  });

  it("refuses to use a value as a trigger and vice versa", () => {
    const bus = new SignalBus(() => 0);
    bus.set("a", 1);
    expect(() => bus.fire("a")).toThrow();
    bus.fire("b");
    expect(() => bus.set("b", 1)).toThrow();
  });

  it("lists declared signals sorted by name with their ranges", () => {
    const bus = new SignalBus(() => 0);
    bus.declare("audio.bpm", "value", { min: 0, max: 200 });
    bus.declare("audio.bass", "value");
    expect(bus.list().map((s) => [s.name, s.max])).toEqual([
      ["audio.bass", 1],
      ["audio.bpm", 200],
    ]);
  });
});
