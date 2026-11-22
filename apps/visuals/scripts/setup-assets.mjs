// Copies MediaPipe's WebAssembly files and downloads the pose model into
// public/mediapipe, so the app runs offline once set up (no CDN at the gig).
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "mediapipe");
mkdirSync(join(out, "models"), { recursive: true });

cpSync(join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm"), join(out, "wasm"), {
  recursive: true,
});

const models = {
  "pose_landmarker_lite.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  "pose_landmarker_full.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};

for (const [name, url] of Object.entries(models)) {
  const target = join(out, "models", name);
  if (existsSync(target)) continue;
  if (process.env.SKIP_MODEL_DOWNLOAD) continue;
  process.stdout.write(`Downloading ${name}... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${url}: ${res.status}`);
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log("done");
}
