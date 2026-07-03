'use client';

import { useState } from 'react';
import { LANDMARKS } from '@/game/landmark-data';

interface Props {
  discovered: string[];
  onPlay: () => void;
  onSettings: () => void;
}

const STUD_COLORS = ['#d6382c', '#f7d354', '#2c6bd6', '#4cb227'];

export default function MainMenu({ discovered, onPlay, onSettings }: Props) {
  const [showCollection, setShowCollection] = useState(false);
  const found = new Set(discovered);

  return (
    <div className="fixed inset-0 z-20 flex flex-col animate-fade-in">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/75" />

      <div className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="glass mb-6 rounded-full px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
          A tiny planet of bricks · ten wonders
        </div>

        <div className="animate-float-soft mb-4 flex gap-2.5">
          {STUD_COLORS.map((c, i) => (
            <span
              key={i}
              className="animate-brick-pop h-4 w-4 rounded-full shadow-md"
              style={{ backgroundColor: c, animationDelay: `${0.15 + i * 0.08}s` }}
            />
          ))}
        </div>

        <h1 className="title-glow font-display text-7xl font-extrabold tracking-tight sm:text-8xl">
          BRICK<span className="text-[#f7d354]">FLY</span>
        </h1>
        <p className="mt-4 max-w-md text-sm font-medium text-white/70 sm:text-base">
          Circle a hand-built Earth. Chase sunsets over brick oceans and find every wonder.
        </p>

        <div className="mt-10 flex w-72 flex-col gap-3">
          <button
            onClick={onPlay}
            className="spring font-display rounded-2xl bg-[#f7d354] px-8 py-4 text-lg font-extrabold tracking-tight text-black shadow-[0_12px_40px_rgba(247,211,84,0.35)] hover:scale-[1.04] hover:shadow-[0_16px_50px_rgba(247,211,84,0.5)] active:scale-95"
          >
            Take Flight
          </button>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCollection(true)}
              className="spring glass flex-1 rounded-2xl px-4 py-3.5 text-sm font-semibold hover:scale-[1.04] active:scale-95"
            >
              Collection
              <span className="ml-2 rounded-full bg-[#f7d354]/20 px-2 py-0.5 text-xs font-bold text-[#f7d354]">
                {discovered.length}/{LANDMARKS.length}
              </span>
            </button>
            <button
              onClick={onSettings}
              className="spring glass flex-1 rounded-2xl px-4 py-3.5 text-sm font-semibold hover:scale-[1.04] active:scale-95"
            >
              Settings
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pb-6 text-[11px] font-medium text-white/45">
        <span>
          <span className="kbd">W</span> <span className="kbd">S</span> pitch
        </span>
        <span>
          <span className="kbd">A</span> <span className="kbd">D</span> roll
        </span>
        <span>
          <span className="kbd">Q</span> <span className="kbd">E</span> yaw
        </span>
        <span>
          <span className="kbd">Space</span> <span className="kbd">Shift</span> throttle
        </span>
        <span>
          <span className="kbd">1</span>–<span className="kbd">4</span> cameras
        </span>
        <span>drag to look</span>
      </div>

      {showCollection && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in"
          onClick={() => setShowCollection(false)}
        >
          <div
            className="glass-strong max-h-[80vh] w-[min(680px,92vw)] overflow-y-auto rounded-3xl p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-extrabold tracking-tight">Collection</h2>
                <p className="text-xs text-white/50">
                  {discovered.length} of {LANDMARKS.length} landmarks discovered
                </p>
              </div>
              <button
                onClick={() => setShowCollection(false)}
                className="spring glass rounded-full px-4 py-2 text-xs font-bold hover:scale-105"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LANDMARKS.map((lm) => {
                const isFound = found.has(lm.id);
                return (
                  <div
                    key={lm.id}
                    className={`spring rounded-2xl border p-4 ${
                      isFound
                        ? 'border-[#f7d354]/40 bg-[#f7d354]/10'
                        : 'border-white/10 bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className={`font-display text-sm font-bold ${isFound ? '' : 'text-white/45'}`}>
                        {isFound ? lm.name : '???'}
                      </h3>
                      {isFound && (
                        <span className="rounded-full bg-[#f7d354] px-2 py-0.5 text-[10px] font-black text-black">
                          FOUND
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-white/50">{isFound ? lm.location : 'Keep exploring…'}</p>
                    {isFound && <p className="mt-2 text-xs leading-relaxed text-white/65">{lm.fact}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
