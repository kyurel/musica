// Turns pose landmarks into body signals. Pure, so it can be tested with
// hand-made poses. Landmarks follow MediaPipe Pose: x/y normalized to the image
// (0..1, y grows downwards), indices below.
//
// Everything is measured in "torso lengths" (shoulders to hips), so the values
// mean the same whether the DJ stands close to the camera or far away.

export interface Point {
  x: number;
  y: number;
  visibility?: number;
}

export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

const TRACKED_FOR_MOTION = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftWrist, LM.rightWrist];

export interface BodyFrame {
  present: boolean;
  /** 0 = hand at hip height, 0.5 = shoulder height, 1 = a torso length above the shoulders. */
  leftHandHeight: number;
  rightHandHeight: number;
  /** Horizontal body position, 0 = left edge of the image, 1 = right edge. */
  centerX: number;
  /** Distance between the hands, 0 = together, 1 = very wide (about 4 shoulder widths). */
  spread: number;
  /** How much the body is moving, smoothed, 0..1. */
  motion: number;
  /** Fires once when both hands go above the head (released when they drop below the shoulders). */
  handsUp: boolean;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const visible = (p: Point | undefined, min = 0.5): p is Point => !!p && (p.visibility ?? 1) >= min;
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export class BodyFeatures {
  private prev: Point[] | null = null;
  private motion = 0;
  private handsUpLatched = false;
  private last: BodyFrame = {
    present: false,
    leftHandHeight: 0,
    rightHandHeight: 0,
    centerX: 0.5,
    spread: 0,
    motion: 0,
    handsUp: false,
  };

  /** `pose` is null when nobody is in view. `dt` in seconds. */
  process(pose: Point[] | null, dt: number): BodyFrame {
    const ls = pose?.[LM.leftShoulder];
    const rs = pose?.[LM.rightShoulder];
    const lh = pose?.[LM.leftHip];
    const rh = pose?.[LM.rightHip];
    if (!pose || !visible(ls) || !visible(rs) || !visible(lh, 0.3) || !visible(rh, 0.3)) {
      this.prev = null;
      this.motion *= Math.exp(-dt / 0.3);
      this.handsUpLatched = false;
      this.last = { ...this.last, present: false, motion: this.motion, handsUp: false };
      return this.last;
    }

    const shoulders = mid(ls, rs);
    const hips = mid(lh, rh);
    const torso = Math.max(1e-3, dist(shoulders, hips));
    const shoulderWidth = Math.max(1e-3, dist(ls, rs));

    const height = (wrist: Point | undefined, previous: number): number =>
      visible(wrist) ? clamp01(((shoulders.y - wrist.y) / torso + 1) / 2) : previous;
    const lw = pose[LM.leftWrist];
    const rw = pose[LM.rightWrist];
    const leftHandHeight = height(lw, this.last.leftHandHeight);
    const rightHandHeight = height(rw, this.last.rightHandHeight);

    const spread = visible(lw) && visible(rw) ? clamp01(dist(lw, rw) / shoulderWidth / 4) : this.last.spread;

    // Motion: average landmark speed in torso lengths per second, smoothed.
    let speed = 0;
    if (this.prev && dt > 0) {
      let n = 0;
      for (const i of TRACKED_FOR_MOTION) {
        const a = pose[i];
        const b = this.prev[i];
        if (visible(a) && b) {
          speed += dist(a, b) / torso / dt;
          n++;
        }
      }
      speed = n > 0 ? speed / n : 0;
    }
    this.prev = pose.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility }));
    this.motion += (clamp01(speed / 4) - this.motion) * (1 - Math.exp(-dt / 0.15));

    // Hands up: both wrists above the nose. Hysteresis so it fires once per raise.
    const nose = pose[LM.nose];
    const headY = visible(nose) ? nose.y : shoulders.y - torso * 0.5;
    const bothAbove = visible(lw) && visible(rw) && lw.y < headY && rw.y < headY;
    const bothBelowShoulders = !visible(lw) || !visible(rw) || (lw.y > shoulders.y && rw.y > shoulders.y);
    let handsUp = false;
    if (!this.handsUpLatched && bothAbove) {
      this.handsUpLatched = true;
      handsUp = true;
    } else if (this.handsUpLatched && bothBelowShoulders) {
      this.handsUpLatched = false;
    }

    this.last = {
      present: true,
      leftHandHeight,
      rightHandHeight,
      centerX: clamp01(hips.x),
      spread,
      motion: this.motion,
      handsUp,
    };
    return this.last;
  }
}
