// The signal bus: every input (audio, controllers, body) publishes here, and
// everything downstream (mappings, effects, the debug screen) reads from here.
//
// Two kinds of signal, matching the two kinds of mapping:
//   - value:   a number that is always "current" (bass level, hand height, a fader).
//              Most values are normalized to 0..1; `min`/`max` say otherwise (e.g. BPM).
//   - trigger: a moment in time (a beat, a drop, hands raised, a pad hit).
//
// Names are dotted paths: "<source>.<thing>[.<detail>]", e.g. "audio.bass",
// "audio.beat", "body.leftHand.height", "midi.ddj-flx4.ch1.cc19".

export type SignalKind = "value" | "trigger";

export interface SignalInfo {
  name: string;
  kind: SignalKind;
  /** Display range for values. Defaults to 0..1. */
  min: number;
  max: number;
  /** Short human description, shown in the debug screen and later the editor. */
  label?: string;
}

export interface SignalState extends SignalInfo {
  /** Current value (values) or strength of the last firing (triggers). */
  value: number;
  /** Time (ms, performance.now clock) of the last update or firing. */
  updatedAt: number;
  /** Times this trigger has fired since start. Always 0 for values. */
  count: number;
}

export type TriggerListener = (name: string, strength: number, at: number) => void;

export interface DeclareOptions {
  min?: number;
  max?: number;
  label?: string;
}

export class SignalBus {
  private readonly signals = new Map<string, SignalState>();
  private readonly triggerListeners = new Set<TriggerListener>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Register a signal up front so it shows in lists before its first update. */
  declare(name: string, kind: SignalKind, opts: DeclareOptions = {}): void {
    const existing = this.signals.get(name);
    if (existing) {
      if (existing.kind !== kind) {
        throw new Error(`Signal ${name} is a ${existing.kind}, not a ${kind}`);
      }
      return;
    }
    this.signals.set(name, {
      name,
      kind,
      min: opts.min ?? 0,
      max: opts.max ?? 1,
      label: opts.label,
      value: 0,
      updatedAt: 0,
      count: 0,
    });
  }

  /** Publish the current value of a value signal (declares it on first use). */
  set(name: string, value: number, opts?: DeclareOptions): void {
    this.declare(name, "value", opts);
    const s = this.signals.get(name)!;
    if (s.kind !== "value") throw new Error(`Signal ${name} is a trigger; use fire()`);
    s.value = Number.isFinite(value) ? value : 0;
    s.updatedAt = this.now();
  }

  /** Fire a trigger signal (declares it on first use). Strength is 0..1. */
  fire(name: string, strength = 1, opts?: DeclareOptions): void {
    this.declare(name, "trigger", opts);
    const s = this.signals.get(name)!;
    if (s.kind !== "trigger") throw new Error(`Signal ${name} is a value; use set()`);
    const at = this.now();
    s.value = strength;
    s.updatedAt = at;
    s.count += 1;
    for (const listener of this.triggerListeners) listener(name, strength, at);
  }

  /** Current value of a signal, or 0 if it doesn't exist yet. */
  get(name: string): number {
    return this.signals.get(name)?.value ?? 0;
  }

  state(name: string): SignalState | undefined {
    return this.signals.get(name);
  }

  /** All signals, sorted by name. */
  list(): SignalState[] {
    return [...this.signals.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  onTrigger(listener: TriggerListener): () => void {
    this.triggerListeners.add(listener);
    return () => this.triggerListeners.delete(listener);
  }
}
