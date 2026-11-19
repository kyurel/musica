import { describe, expect, it } from "vitest";
import { compatibleKeys, notation } from "./keys";

describe("keys", () => {
  it("shows musical notation for Camelot codes", () => {
    expect(notation("8A")).toBe("A minor");
    expect(notation("8B")).toBe("C major");
    expect(notation("1B")).toBe("B major");
    expect(notation("5A")).toBe("C minor");
    expect(notation("atonal")).toBe("atonal");
  });

  it("lists harmonic neighbours, wrapping around 12", () => {
    expect(compatibleKeys("8A")).toEqual(["8A", "9A", "7A", "8B"]);
    expect(compatibleKeys("12B")).toEqual(["12B", "1B", "11B", "12A"]);
    expect(compatibleKeys("1A")).toEqual(["1A", "2A", "12A", "1B"]);
  });
});
