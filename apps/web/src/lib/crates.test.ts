import { describe, expect, it } from "vitest";
import { crateName, move } from "./crates";

describe("crates", () => {
  it("moves a track one step", () => {
    expect(move(["a", "b", "c"], "c", -1)).toEqual([{ track_id: "c", position: 1 }, { track_id: "b", position: 2 }]);
    expect(move(["a", "b", "c"], "a", 1)).toEqual([{ track_id: "b", position: 0 }, { track_id: "a", position: 1 }]);
  });

  it("does nothing at the ends or for unknown tracks", () => {
    expect(move(["a", "b"], "a", -1)).toEqual([]);
    expect(move(["a", "b"], "b", 1)).toEqual([]);
    expect(move(["a"], "x", 1)).toEqual([]);
  });

  it("cleans crate names", () => {
    expect(crateName("  Friday   peak ")).toBe("Friday peak");
    expect(() => crateName("  ")).toThrow();
  });
});
