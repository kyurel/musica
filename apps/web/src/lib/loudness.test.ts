import { describe, expect, it } from "vitest";
import { matchGain } from "./loudness";

describe("matchGain", () => {
  it("turns a loud club master down to the target", () => {
    expect(matchGain(-6)).toBeCloseTo(Math.pow(10, -8 / 20));
  });
  it("leaves unknown loudness alone and caps boosts", () => {
    expect(matchGain(null)).toBe(1);
    expect(matchGain(-60)).toBeCloseTo(Math.pow(10, 12 / 20));
  });
});
