"use client";

import { createContext, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { matchGain } from "@/lib/loudness";

type Item = { versionId: string; title: string; lufs: number | null };
type Ctx = { play: (item: Item) => void; current: Item | null };

const PlayerContext = createContext<Ctx>({ play: () => {}, current: null });

/** One shared player. Switching tracks keeps the position, so A/B at the same spot is one click. */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const graph = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  const [current, setCurrent] = useState<Item | null>(null);
  const [levelMatch, setLevelMatch] = useState(true);

  function ensureGraph() {
    if (!graph.current && audio.current) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      ctx.createMediaElementSource(audio.current).connect(gain).connect(ctx.destination);
      graph.current = { ctx, gain };
    }
    return graph.current;
  }

  function apply(item: Item | null, match: boolean) {
    const g = ensureGraph();
    if (g) g.gain.gain.value = match && item ? matchGain(item.lufs) : 1;
  }

  async function play(item: Item) {
    const el = audio.current;
    if (!el) return;
    const at = el.currentTime;
    const switching = current && current.versionId !== item.versionId;
    el.src = `/api/previews/${item.versionId}`;
    if (switching) el.currentTime = at;
    apply(item, levelMatch);
    setCurrent(item);
    await graph.current?.ctx.resume();
    await el.play();
  }

  return (
    <PlayerContext.Provider value={{ play, current }}>
      {children}
      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t bg-background py-3 text-sm">
        <span className="min-w-0 flex-1 truncate">{current ? current.title : "Nothing playing"}</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={levelMatch} onChange={(e) => { setLevelMatch(e.target.checked); apply(current, e.target.checked); }} />
          level-matched
        </label>
        <audio ref={audio} controls crossOrigin="anonymous" className="h-8" />
      </div>
    </PlayerContext.Provider>
  );
}

export function PlayButton(item: Item) {
  const { play, current } = useContext(PlayerContext);
  const active = current?.versionId === item.versionId;
  return (
    <Button size="sm" variant={active ? "default" : "outline"} onClick={() => play(item)} aria-label={`Play ${item.title}`}>
      ▶
    </Button>
  );
}
