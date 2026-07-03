'use client';

import { useEffect, useState } from 'react';
import { bus } from '@/game/bus';
import { getGame } from '@/game/game';
import { CAMERA_NAMES, CameraMode } from '@/game/camera';
import { LandmarkDef } from '@/game/landmark-data';
import Minimap from './Minimap';

interface HudData {
  alt: number;
  speed: number;
  heading: number;
  throttle: number;
  maxSpeed: number;
}

interface LandmarkEvent {
  def: LandmarkDef;
  isNew: boolean;
}

interface DiscoveryEvent {
  def: LandmarkDef;
  count: number;
  total: number;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function cardinal(heading: number): string {
  return CARDINALS[Math.round(heading / 45) % 8];
}

export default function HUD({ paused }: { paused: boolean }) {
  const [hud, setHud] = useState<HudData>({ alt: 0, speed: 0, heading: 0, throttle: 0.5, maxSpeed: 340 });
  const [landmark, setLandmark] = useState<LandmarkEvent | null>(null);
  const [toast, setToast] = useState<DiscoveryEvent | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>(0);
  const [crashed, setCrashed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const offs = [
      bus.on('hud', (d) => setHud(d as HudData)),
      bus.on('landmark', (d) => setLandmark(d as LandmarkEvent | null)),
      bus.on('camera', (m) => setCameraMode(m as CameraMode)),
      bus.on('crash', () => setCrashed(true)),
      bus.on('respawn', () => setCrashed(false)),
      bus.on('discovered', (d) => {
        setToast(d as DiscoveryEvent);
        window.setTimeout(() => setToast(null), 4000);
      })
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') setShowHelp((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Compass ribbon marks within ±52° of the current heading
  const marks: { deg: number; offset: number }[] = [];
  for (let deg = 0; deg < 360; deg += 15) {
    let delta = deg - hud.heading;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    if (Math.abs(delta) <= 52) marks.push({ deg, offset: delta * 2.4 });
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-10 select-none">
      {/* Compass */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2">
        <div className="glass relative h-12 w-72 overflow-hidden rounded-2xl">
          {marks.map((m) => {
            const label = m.deg % 90 === 0 ? 'NESW'[Math.floor(m.deg / 90) % 4] : null;
            return (
              <div
                key={m.deg}
                className="absolute top-0 flex h-full flex-col items-center justify-center"
                style={{ left: `calc(50% + ${m.offset}px)` }}
              >
                {label ? (
                  <span className="text-sm font-bold text-white/90">{label}</span>
                ) : (
                  <span className="h-2 w-px bg-white/40" />
                )}
              </div>
            );
          })}
          <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-[#f7d354]" />
        </div>
        <div className="mt-1 text-center text-[11px] font-semibold tabular-nums text-white/70">
          {String(hud.heading).padStart(3, '0')}° {cardinal(hud.heading)}
        </div>
      </div>

      {/* Minimap */}
      <div className="absolute right-4 top-4">
        <Minimap />
      </div>

      {/* Speed + throttle + altitude */}
      <div className="absolute bottom-5 left-4 flex items-end gap-3">
        <div className="glass flex items-end gap-3 rounded-2xl px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Speed</div>
            <div className="text-3xl font-black tabular-nums leading-none">{hud.speed}</div>
          </div>
          <div className="mb-0.5 h-14 w-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="w-full rounded-full bg-gradient-to-t from-[#4cb227] to-[#f7d354] transition-[height] duration-200"
              style={{
                height: `${Math.round(hud.throttle * 100)}%`,
                marginTop: `${Math.round((1 - hud.throttle) * 100)}%`
              }}
            />
          </div>
        </div>
        <div className="glass rounded-2xl px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Altitude</div>
          <div className="text-3xl font-black tabular-nums leading-none">{hud.alt}</div>
        </div>
      </div>

      {/* Camera dock */}
      <div className="pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
        <div className="glass flex gap-1 rounded-2xl p-1.5">
          {CAMERA_NAMES.map((name, i) => (
            <button
              key={name}
              onClick={() => getGame()?.setCameraMode(i as CameraMode)}
              className={`spring rounded-xl px-3 py-2 text-[11px] font-bold ${
                cameraMode === i ? 'bg-white text-black' : 'text-white/60 hover:text-white'
              }`}
            >
              <span className="mr-1 opacity-50">{i + 1}</span>
              {name}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="spring glass rounded-2xl px-3.5 py-3 text-[11px] font-bold text-white/60 hover:text-white"
        >
          H
        </button>
      </div>

      {/* Landmark card */}
      {landmark && (
        <div className="animate-card-in absolute left-4 top-1/2 w-80 -translate-y-1/2">
          <div className="glass-strong rounded-3xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-black tracking-tight">{landmark.def.name}</h3>
                <p className="text-xs font-medium text-white/55">{landmark.def.location}</p>
              </div>
              {landmark.isNew && (
                <span className="rounded-full bg-[#f7d354] px-2.5 py-1 text-[10px] font-black text-black">NEW</span>
              )}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-white/75">{landmark.def.fact}</p>
          </div>
        </div>
      )}

      {/* Discovery toast */}
      {toast && (
        <div className="animate-toast-in absolute left-1/2 top-24 -translate-x-1/2">
          <div className="glass-strong flex items-center gap-3 rounded-2xl px-5 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f7d354] text-sm font-black text-black">
              ★
            </span>
            <div>
              <div className="text-sm font-bold">Landmark discovered — {toast.def.name}</div>
              <div className="text-[11px] text-white/55">
                {toast.count} of {toast.total} collected
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Crash overlay */}
      {crashed && (
        <>
          <div className="animate-crash-flash absolute inset-0 bg-red-500/40" />
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 text-center">
            <div className="glass-strong rounded-2xl px-6 py-4">
              <div className="text-lg font-black">Ouch — bricks everywhere!</div>
              <div className="animate-pulse-soft mt-1 text-xs text-white/60">Rebuilding your plane…</div>
            </div>
          </div>
        </>
      )}

      {/* Help */}
      {showHelp && (
        <div className="pointer-events-auto absolute bottom-24 left-1/2 -translate-x-1/2 animate-fade-in">
          <div className="glass-strong rounded-2xl px-6 py-4 text-xs leading-6 text-white/75">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Controls</div>
            <div className="grid grid-cols-2 gap-x-8">
              <span>W / S · pitch</span>
              <span>A / D · roll</span>
              <span>Q / E · yaw</span>
              <span>Space / Shift · throttle</span>
              <span>1–4 · cameras</span>
              <span>Drag · look around</span>
              <span>Esc · pause</span>
              <span>H · toggle help</span>
            </div>
          </div>
        </div>
      )}

      {paused && <div className="absolute inset-0 bg-black/20" />}
    </div>
  );
}
