'use client';

import { useEffect, useState } from 'react';
import { bus } from '@/game/bus';

const LETTERS = ['B', 'R', 'I', 'C', 'K', 'F', 'L', 'Y'];
const COLORS = ['#d6382c', '#f7a231', '#f7d354', '#4cb227', '#2c6bd6', '#d6382c', '#f7a231', '#4cb227'];

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('Opening the box');

  useEffect(() => {
    return bus.on('progress', (data) => {
      const { pct, label } = data as { pct: number; label: string };
      setProgress(pct);
      setLabel(label);
    });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#06090f]">
      <div className="mb-10 flex gap-2">
        {LETTERS.map((letter, i) => (
          <div
            key={i}
            className="animate-brick-pop relative flex h-14 w-12 items-center justify-center rounded-lg text-2xl font-black text-white shadow-lg sm:h-16 sm:w-14 sm:text-3xl"
            style={{ backgroundColor: COLORS[i], animationDelay: `${i * 0.12}s` }}
          >
            <span className="absolute -top-1.5 left-2 h-2 w-3 rounded-sm opacity-80" style={{ backgroundColor: COLORS[i] }} />
            <span className="absolute -top-1.5 right-2 h-2 w-3 rounded-sm opacity-80" style={{ backgroundColor: COLORS[i] }} />
            {letter}
          </div>
        ))}
      </div>

      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-white transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="animate-pulse-soft mt-4 text-xs font-medium uppercase tracking-[0.25em] text-white/45">{label}…</p>
    </div>
  );
}
