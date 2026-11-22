# Musica Visuals

Live visuals that react to the music and to the DJ's body, using only gear a DJ
already has: a laptop, its webcam, the DJ controller, and a screen or projector.
Free and open source all the way down (GPL-3.0-or-later), no subscriptions.

**Status: step 1 of 4, Signals.** Every input works and shows live on a debug
screen. No visuals yet: that's step 2 (engine) and step 3 (demo scenes).

## Run it on the Mac

Needs Node 22+ and Chrome (Web MIDI and the webcam model need Chrome).

```sh
cd apps/visuals
npm install
npm run dev        # first run downloads the pose models (~15 MB) into public/mediapipe
```

Open http://localhost:5174 in Chrome, then:

1. Pick an **audio input** and press **Start audio**. Allow the microphone.
2. Press **Start camera**. Allow the camera. Step back so your hips are in view.
3. Plug in the FLX4 (and/or the MPK) and allow MIDI. Move a knob: it appears in
   the Controllers box and in the signal list.

Once set up it works offline: the models and MediaPipe files are served locally.

## Getting the music in

The app listens to an audio input. Two ways to feed it:

- **Built-in microphone** (works today, zero setup): pick "MacBook Pro Microphone"
  and play through the Rokits. Auto-gain adapts to the room's loudness.
- **BlackHole loopback** (cleaner, no room noise): install
  [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole) (free, open source)
  and send rekordbox's master to it as well as to the speakers. The app picks
  BlackHole automatically when it's there. Whether rekordbox can feed BlackHole
  while it drives the FLX4 is the first thing to test on the real setup.

Ableton Link from rekordbox (exact beat grid) comes in step 4.

## Signals

Everything is published on one signal bus (`src/signals/bus.ts`). Values are
0..1 unless the list says otherwise; triggers are moments.

| Signal | Kind | Meaning |
|---|---|---|
| `audio.level` | value | Overall loudness, auto-gained |
| `audio.bass` / `.mid` / `.high` | value | Energy in 30-150 Hz / 150-2000 Hz / 2-12 kHz, auto-gained |
| `audio.beat` | trigger | A kick or beat onset |
| `audio.bpm` | value (0-200) | Estimated tempo, folded into 85-170 (174 DnB reads as 87) |
| `audio.bpmConfidence` | value | How sure the tempo is |
| `audio.beatPhase` | value | Position inside the current beat |
| `audio.breakdown` | value | 1 while the bass is gone for 2 s or more |
| `audio.drop` | trigger | The bass comes back after a breakdown |
| `body.present` | value | 1 when someone is in view |
| `body.leftHand.height` / `body.rightHand.height` | value | 0 at the hips, 0.5 at the shoulders, 1 a torso length above |
| `body.centerX` | value | Where the body is, left to right |
| `body.spread` | value | Distance between the hands |
| `body.motion` | value | How much the body is moving |
| `body.handsUp` | trigger | Both hands raised above the head (once per raise) |
| `midi.<device>.ch<N>.cc<N>` | value | Any knob or fader of any controller |
| `midi.<device>.ch<N>.note<N>` | value | A pad or button, held velocity |
| `midi.<device>.ch<N>.note<N>.on` | trigger | A pad or button hit |
| `midi.<device>.ch<N>.pitch` | value | Pitch bend / 14-bit controls |

MIDI signals are named generically so any controller works with no setup;
friendly names ("crossfader", "pad 1") come with the editor in step 3.

## Layout

| Path | What |
|---|---|
| `src/signals/bus.ts` | The signal bus |
| `src/signals/audio/analysis.ts` | Pure audio analysis: bands, auto-gain, onsets, tempo, drops |
| `src/signals/audio/source.ts` | Web Audio input to the bus |
| `src/signals/midi/` | MIDI parsing (pure) and Web MIDI input |
| `src/signals/body/features.ts` | Pure pose to body signals |
| `src/signals/body/source.ts` | Webcam + MediaPipe Pose + silhouette mask |
| `src/main.ts`, `src/debug/` | The debug screen |
| `scripts/setup-assets.mjs` | Copies MediaPipe files and downloads models for offline use |

## Checks

```sh
npm run typecheck
npm test
npm run build
```

## Plan

1. **Signals** (this): every input working and visible.
2. **Engine**: one-file effects plus ISF shaders, layer stack, continuous and
   trigger mappings, scenes, presets as files, event profiles with strobe and
   brightness limits.
3. **Demo**: three scenes, editor with modulation matrix, MPK macros, SHIFT+pad
   scene switching, 60 fps on the MacBook Pro next to rekordbox.
4. **Gig-ready**: Ableton Link, loudness and camera calibration, corner-pin output.
