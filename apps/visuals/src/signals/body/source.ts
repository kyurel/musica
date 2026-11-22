// Webcam + MediaPipe Pose. Publishes body signals and keeps the latest
// silhouette mask for effects to use. Any future body sensor (depth camera,
// phone) only has to produce the same BodyFrame + mask to plug in here.

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { SignalBus } from "../bus";
import { BodyFeatures, type Point } from "./features";

export type PoseModel = "lite" | "full";

export function declareBodySignals(bus: SignalBus): void {
  bus.declare("body.present", "value", { label: "1 when someone is in view" });
  bus.declare("body.leftHand.height", "value", { label: "0 hip, 0.5 shoulder, 1 well above head" });
  bus.declare("body.rightHand.height", "value", { label: "0 hip, 0.5 shoulder, 1 well above head" });
  bus.declare("body.centerX", "value", { label: "Where the body is, left to right" });
  bus.declare("body.spread", "value", { label: "Distance between the hands" });
  bus.declare("body.motion", "value", { label: "How much the body is moving" });
  bus.declare("body.handsUp", "trigger", { label: "Both hands raised above the head" });
}

export class BodySource {
  readonly video: HTMLVideoElement;
  /** Silhouette: white where the person is, transparent elsewhere. Same size as the mask. */
  readonly mask: HTMLCanvasElement;
  /** Latest landmarks, for drawing the skeleton. */
  landmarks: Point[] | null = null;
  fps = 0;

  private landmarker: PoseLandmarker | null = null;
  private stream: MediaStream | null = null;
  private readonly features = new BodyFeatures();
  private lastVideoTime = -1;
  private lastDetect = 0;
  private maskImage: ImageData | null = null;

  constructor(private readonly bus: SignalBus) {
    declareBodySignals(bus);
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.mask = document.createElement("canvas");
  }

  get running(): boolean {
    return this.landmarker !== null;
  }

  async start(model: PoseModel = "lite", cameraId?: string): Promise<void> {
    this.stop();
    const base = import.meta.env.BASE_URL;
    const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `${base}mediapipe/models/pose_landmarker_${model}.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      outputSegmentationMasks: true,
    });
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: cameraId ? { exact: cameraId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.landmarks = null;
  }

  /** Call once per animation frame. Only runs the model when the camera has a new frame. */
  update(now: number): void {
    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const dt = this.lastDetect > 0 ? (now - this.lastDetect) / 1000 : 1 / 30;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;
    this.lastDetect = now;

    const result = this.landmarker.detectForVideo(this.video, now);
    try {
      this.landmarks = result.landmarks[0] ?? null;
      const mask = result.segmentationMasks?.[0];
      if (mask) this.copyMask(mask.width, mask.height, mask.getAsFloat32Array());
    } finally {
      result.close();
    }

    const f = this.features.process(this.landmarks, dt);
    const bus = this.bus;
    bus.set("body.present", f.present ? 1 : 0);
    bus.set("body.leftHand.height", f.leftHandHeight);
    bus.set("body.rightHand.height", f.rightHandHeight);
    bus.set("body.centerX", f.centerX);
    bus.set("body.spread", f.spread);
    bus.set("body.motion", f.motion);
    if (f.handsUp) bus.fire("body.handsUp");
  }

  private copyMask(width: number, height: number, data: Float32Array): void {
    if (this.mask.width !== width || this.mask.height !== height || !this.maskImage) {
      this.mask.width = width;
      this.mask.height = height;
      this.maskImage = new ImageData(width, height);
    }
    const px = this.maskImage.data;
    for (let i = 0; i < data.length; i++) {
      const o = i * 4;
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      px[o + 3] = Math.round((data[i] ?? 0) * 255);
    }
    this.mask.getContext("2d")!.putImageData(this.maskImage, 0, 0);
  }
}

export async function listCameras(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}
