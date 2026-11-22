import { describe, expect, it } from "vitest";
import { BodyFeatures, LM, type Point } from "./features";

const DT = 1 / 30;

/** A standing person: shoulders at y=0.4, hips at y=0.7 (torso = 0.3), hands at the given heights. */
function pose(opts: { leftWristY?: number; rightWristY?: number; dx?: number } = {}): Point[] {
  const dx = opts.dx ?? 0;
  const p: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  p[LM.nose] = { x: 0.5 + dx, y: 0.28, visibility: 0.9 };
  p[LM.leftShoulder] = { x: 0.6 + dx, y: 0.4, visibility: 0.9 };
  p[LM.rightShoulder] = { x: 0.4 + dx, y: 0.4, visibility: 0.9 };
  p[LM.leftHip] = { x: 0.57 + dx, y: 0.7, visibility: 0.9 };
  p[LM.rightHip] = { x: 0.43 + dx, y: 0.7, visibility: 0.9 };
  p[LM.leftWrist] = { x: 0.65 + dx, y: opts.leftWristY ?? 0.7, visibility: 0.9 };
  p[LM.rightWrist] = { x: 0.35 + dx, y: opts.rightWristY ?? 0.7, visibility: 0.9 };
  return p;
}

describe("BodyFeatures", () => {
  it("reports nobody when there is no pose", () => {
    const f = new BodyFeatures().process(null, DT);
    expect(f.present).toBe(false);
    expect(f.handsUp).toBe(false);
  });

  it("measures hand height in torso lengths", () => {
    const b = new BodyFeatures();
    expect(b.process(pose({ leftWristY: 0.7 }), DT).leftHandHeight).toBeCloseTo(0); // at hips
    expect(b.process(pose({ leftWristY: 0.4 }), DT).leftHandHeight).toBeCloseTo(0.5); // at shoulders
    expect(b.process(pose({ leftWristY: 0.1 }), DT).leftHandHeight).toBeCloseTo(1); // a torso above
  });

  it("fires hands-up once per raise", () => {
    const b = new BodyFeatures();
    const fired: boolean[] = [];
    const steps = [0.7, 0.2, 0.2, 0.2, 0.35, 0.2, 0.7, 0.2]; // 0.35: dips under the head but not the shoulders
    for (const y of steps) fired.push(b.process(pose({ leftWristY: y, rightWristY: y }), DT).handsUp);
    expect(fired).toEqual([false, true, false, false, false, false, false, true]);
  });

  it("does not fire hands-up for one hand", () => {
    const b = new BodyFeatures();
    expect(b.process(pose({ leftWristY: 0.1 }), DT).handsUp).toBe(false);
  });

  it("measures motion and lets it settle when still", () => {
    const b = new BodyFeatures();
    let moving = 0;
    for (let i = 0; i < 30; i++) moving = b.process(pose({ dx: i % 2 === 0 ? 0 : 0.05 }), DT).motion;
    let still = 0;
    for (let i = 0; i < 30; i++) still = b.process(pose(), DT).motion;
    expect(moving).toBeGreaterThan(0.5);
    expect(still).toBeLessThan(0.05);
  });

  it("reports position and spread, and ignores low-visibility wrists", () => {
    const b = new BodyFeatures();
    const f = b.process(pose(), DT);
    expect(f.centerX).toBeCloseTo(0.5);
    expect(f.spread).toBeCloseTo(0.3 / 0.2 / 4);

    const hidden = pose({ leftWristY: 0.1 });
    hidden[LM.leftWrist]!.visibility = 0.1;
    expect(b.process(hidden, DT).leftHandHeight).toBeCloseTo(0); // keeps the last good value
  });
});
