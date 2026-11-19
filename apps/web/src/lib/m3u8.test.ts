import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { joinRoot, renderM3u8, safeFilename } from "./m3u8";

const golden = join(__dirname, "..", "..", "..", "..", "testdata", "golden");

describe("m3u8", () => {
  it("matches the golden file shared with the worker", () => {
    const input = JSON.parse(readFileSync(join(golden, "m3u8-input.json"), "utf8"));
    expect(renderM3u8(input)).toBe(readFileSync(join(golden, "basic.m3u8"), "utf8"));
  });

  it("never lets a title add a line", () => {
    const out = renderM3u8({ name: "x", entries: [{ path: "/a.mp3", title: "t\n/evil.mp3\u2028#EXTINF" }] });
    expect(out.split("\n")).toEqual(["#EXTM3U", "#PLAYLIST:x", "#EXTINF:-1,t /evil.mp3 #EXTINF", "/a.mp3", ""]);
  });

  it("makes safe file names and paths", () => {
    expect(safeFilename("Peak: 145/150?")).toBe("Peak 145 150");
    expect(safeFilename("../..")).toBe("playlist");
    expect(joinRoot("/Users/andre/Music/Musica/", "Inbox/a.flac")).toBe("/Users/andre/Music/Musica/Inbox/a.flac");
  });
});
