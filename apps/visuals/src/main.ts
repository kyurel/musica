// Step 1 entry point: starts the inputs and shows every signal live, so we can
// check on the real Mac, with the real FLX4 and music, that each input works
// before building the visual engine on top of them.

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { SignalBus } from "./signals/bus";
import { AudioSource, listAudioInputs } from "./signals/audio/source";
import { MidiSource } from "./signals/midi/source";
import { BodySource, listCameras, type PoseModel } from "./signals/body/source";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const bus = new SignalBus();
const audio = new AudioSource(bus);
const midi = new MidiSource(bus);
const body = new BodySource(bus);

// ---------- Controls ----------

async function fillSelect(select: HTMLSelectElement, items: { id: string; label: string }[]): Promise<void> {
  const current = select.value;
  select.length = 1; // keep the "Default" option
  for (const item of items) select.add(new Option(item.label, item.id));
  select.value = items.some((i) => i.id === current) ? current : "";
}

const audioSelect = $<HTMLSelectElement>("audio-device");
const cameraSelect = $<HTMLSelectElement>("camera-device");
const audioButton = $<HTMLButtonElement>("audio-start");
const cameraButton = $<HTMLButtonElement>("camera-start");

async function refreshDevices(): Promise<void> {
  await fillSelect(audioSelect, await listAudioInputs());
  await fillSelect(cameraSelect, await listCameras());
  // Pick BlackHole automatically if it exists: it's the loopback we recommend.
  if (!audioSelect.value) {
    const blackhole = [...audioSelect.options].find((o) => /blackhole/i.test(o.text));
    if (blackhole) audioSelect.value = blackhole.value;
  }
}
navigator.mediaDevices.addEventListener("devicechange", () => void refreshDevices());
void refreshDevices();

async function startAudio(): Promise<void> {
  try {
    await audio.start(audioSelect.value || undefined);
    await refreshDevices(); // labels appear after permission
    $("audio-status").textContent = audio.deviceLabel || "running";
    audioButton.textContent = "Restart audio";
    audioButton.classList.add("on");
  } catch (e) {
    $("audio-status").textContent = `error: ${String(e)}`;
  }
}
audioButton.onclick = () => void startAudio();
audioSelect.onchange = () => {
  if (audio.running) void startAudio();
};

async function startCamera(): Promise<void> {
  $("body-status").textContent = "loading model...";
  try {
    await body.start($<HTMLSelectElement>("pose-model").value as PoseModel, cameraSelect.value || undefined);
    await refreshDevices();
    cameraButton.textContent = "Restart camera";
    cameraButton.classList.add("on");
  } catch (e) {
    $("body-status").textContent = `error: ${String(e)}`;
  }
}
cameraButton.onclick = () => void startCamera();

void midi.start();

// ---------- Rendering ----------

const meters = $("meters");
const meterSignals = ["audio.level", "audio.bass", "audio.mid", "audio.high", "audio.beatPhase"];
const meterEls = new Map<string, { bar: HTMLElement; num: HTMLElement }>();
for (const name of meterSignals) {
  const row = document.createElement("div");
  row.className = "meter";
  row.innerHTML = `<span>${name.replace("audio.", "")}</span><div class="bar"><i></i></div><span class="num"></span>`;
  meters.append(row);
  meterEls.set(name, { bar: row.querySelector("i")!, num: row.querySelector(".num")! });
}

const tableBody = $("signal-table").querySelector("tbody")!;
const rows = new Map<string, { row: HTMLTableRowElement; bar: HTMLElement; num: HTMLElement }>();

function renderSignalTable(now: number): void {
  const signals = bus.list();
  if (signals.length !== rows.size) {
    tableBody.replaceChildren();
    rows.clear();
    for (const s of signals) {
      const row = document.createElement("tr");
      row.className = s.kind;
      row.innerHTML = `<td class="name"></td><td class="barcell"><div class="bar"><i></i></div></td><td class="num"></td><td class="label"></td>`;
      row.cells[0]!.textContent = s.name;
      row.cells[3]!.textContent = s.label ?? "";
      tableBody.append(row);
      rows.set(s.name, { row, bar: row.querySelector("i")!, num: row.cells[2]! });
    }
  }
  for (const s of signals) {
    const r = rows.get(s.name)!;
    if (s.kind === "value") {
      const t = s.max > s.min ? (s.value - s.min) / (s.max - s.min) : 0;
      r.bar.style.width = `${Math.max(0, Math.min(1, t)) * 100}%`;
      r.num.textContent = s.max > 1 ? s.value.toFixed(1) : s.value.toFixed(2);
    } else {
      const age = now - s.updatedAt;
      r.bar.style.opacity = s.count > 0 ? String(Math.max(0, 1 - age / 400)) : "0";
      r.num.textContent = `×${s.count}`;
    }
  }
}

const cameraCanvas = $<HTMLCanvasElement>("camera-view");
const cam = cameraCanvas.getContext("2d")!;
const tint = document.createElement("canvas");

function renderCamera(): void {
  const { width, height } = cameraCanvas;
  cam.save();
  // Mirror, so it feels like a mirror to the DJ.
  cam.translate(width, 0);
  cam.scale(-1, 1);
  cam.fillStyle = "#000";
  cam.fillRect(0, 0, width, height);
  if (body.running && body.video.readyState >= 2) {
    cam.globalAlpha = 0.55;
    cam.drawImage(body.video, 0, 0, width, height);
    cam.globalAlpha = 1;

    // Silhouette, tinted with the accent colour.
    if (body.mask.width > 0) {
      tint.width = body.mask.width;
      tint.height = body.mask.height;
      const t = tint.getContext("2d")!;
      t.drawImage(body.mask, 0, 0);
      t.globalCompositeOperation = "source-in";
      t.fillStyle = "rgba(124, 92, 255, 0.55)";
      t.fillRect(0, 0, tint.width, tint.height);
      t.globalCompositeOperation = "source-over";
      cam.drawImage(tint, 0, 0, width, height);
    }

    const lms = body.landmarks;
    if (lms) {
      cam.strokeStyle = "#3ddc97";
      cam.lineWidth = 3;
      for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
        const a = lms[start];
        const b = lms[end];
        if (!a || !b || (a.visibility ?? 1) < 0.5 || (b.visibility ?? 1) < 0.5) continue;
        cam.beginPath();
        cam.moveTo(a.x * width, a.y * height);
        cam.lineTo(b.x * width, b.y * height);
        cam.stroke();
      }
    }
  }
  cam.restore();

  const status = $("body-status");
  if (body.running) {
    status.textContent = `${bus.get("body.present") ? "tracking" : "nobody in view"} · ${body.fps.toFixed(0)} fps`;
  }
}

let frames = 0;
let fpsSince = performance.now();

function frame(now: number): void {
  audio.update();
  body.update(now);

  for (const [name, el] of meterEls) {
    const v = bus.get(name);
    el.bar.style.width = `${v * 100}%`;
    el.num.textContent = v.toFixed(2);
  }
  const beat = bus.state("audio.beat");
  $("beat-lamp").classList.toggle("lit", !!beat && beat.count > 0 && now - beat.updatedAt < 110);
  const drop = bus.state("audio.drop");
  $("drop-lamp").classList.toggle("lit", !!drop && drop.count > 0 && now - drop.updatedAt < 700);
  $("drop-lamp").classList.toggle("armed", bus.get("audio.breakdown") > 0);
  const bpm = bus.get("audio.bpm");
  $("bpm").textContent = bpm > 0 ? bpm.toFixed(1) : "--";
  $("bpm-conf").textContent = bpm > 0 ? `(${Math.round(bus.get("audio.bpmConfidence") * 100)}% sure)` : "";

  $("midi-status").textContent = midi.error || (midi.devices.length ? midi.devices.join(", ") : "no controller found");
  const log = $("midi-log");
  const latest = midi.log[0]?.at ?? 0;
  if (log.dataset["latest"] !== String(latest)) {
    log.dataset["latest"] = String(latest);
    log.replaceChildren(
      ...midi.log.slice(0, 12).map((e) => {
        const li = document.createElement("li");
        li.textContent = `${e.device}: ${e.text}`;
        return li;
      }),
    );
  }

  renderCamera();
  renderSignalTable(now);

  frames++;
  if (now - fpsSince > 1000) {
    $("fps").textContent = `${Math.round((frames * 1000) / (now - fpsSince))} fps`;
    frames = 0;
    fpsSince = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
