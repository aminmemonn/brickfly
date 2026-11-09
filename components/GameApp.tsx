'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { bus } from '@/game/bus';
import { createGame, getGame } from '@/game/game';
import { DEFAULT_SETTINGS, Settings, loadSettings, saveSettings } from '@/game/settings';
import LoadingScreen from './LoadingScreen';
import MainMenu from './MainMenu';
import HUD from './HUD';
import SettingsPanel from './SettingsPanel';
import AccountButton from './AccountButton';
import CloudSync from './CloudSync';

type Phase = 'boot' | 'menu' | 'playing' | 'paused';

export default function GameApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>('boot');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [discovered, setDiscovered] = useState<string[]>([]);

  useEffect(() => {
    setSettings(loadSettings());
    if (canvasRef.current) createGame(canvasRef.current);
    const offReady = bus.on('ready', () => setPhase((p) => (p === 'boot' ? 'menu' : p)));
    const offCollection = bus.on('collection', (ids) => setDiscovered(ids as string[]));
    return () => {
      offReady();
      offCollection();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      setPhase((p) => {
        if (p === 'playing') {
          getGame()?.pause();
          return 'paused';
        }
        if (p === 'paused') {
          getGame()?.resume();
          return 'playing';
        }
        return p;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const play = useCallback(() => {
    getGame()?.start();
    setPhase('playing');
  }, []);

  const resume = useCallback(() => {
    getGame()?.resume();
    setPhase('playing');
  }, []);

  const quitToMenu = useCallback(() => {
    getGame()?.toMenu();
    setPhase('menu');
  }, []);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
    getGame()?.applySettings(next);
  }, []);

  const click = useCallback(() => getGame()?.uiClick(), []);

  // The flight sim doesn't advance while paused, so this snapshot can't go stale.
  const stats = phase === 'paused' ? getGame()?.sessionStats() : null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#06090f]">
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" />

      {(phase === 'playing' || phase === 'paused') && <HUD paused={phase === 'paused'} />}

      {phase === 'menu' && (
        <MainMenu
          discovered={discovered}
          onPlay={() => {
            click();
            play();
          }}
          onSettings={() => {
            click();
            setShowSettings(true);
          }}
        />
      )}

      {phase === 'paused' && !showSettings && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-sm animate-fade-in">
          <div className="glass-strong mx-4 w-full max-w-sm rounded-3xl p-8 text-center">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.3em] text-white/50">Paused</div>
            <h2 className="font-display mb-5 text-3xl font-extrabold tracking-tight">BRICKFLY</h2>
            {stats && (
              <div className="mb-6 grid grid-cols-3 gap-2">
                <PauseStat label="Flown" value={(stats.distance / 1000).toFixed(1)} unit="km" />
                <PauseStat label="Top speed" value={String(Math.round(stats.topSpeed))} />
                <PauseStat
                  label="Landmarks"
                  value={String(stats.landmarks)}
                  note={stats.newLandmarks > 0 ? `${stats.newLandmarks} new` : undefined}
                />
              </div>
            )}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  click();
                  resume();
                }}
                className="spring rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-black hover:scale-[1.03] active:scale-95"
              >
                Resume Flight
              </button>
              <button
                onClick={() => {
                  click();
                  setShowSettings(true);
                }}
                className="spring glass rounded-2xl px-6 py-3.5 text-sm font-semibold hover:scale-[1.03] active:scale-95"
              >
                Settings
              </button>
              <button
                onClick={() => {
                  click();
                  quitToMenu();
                }}
                className="spring rounded-2xl px-6 py-3.5 text-sm font-semibold text-white/60 hover:text-white"
              >
                Main Menu
              </button>
            </div>
            <p className="mt-5 text-[11px] text-white/35">Press Esc to resume</p>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => {
            click();
            setShowSettings(false);
          }}
        />
      )}

      {phase === 'boot' && <LoadingScreen />}

      {/* Cloud save runs in every phase; the account chip shows only in the menu
          so it never overlaps the in-flight minimap. Both no-op until accounts
          are configured. */}
      <CloudSync />
      {phase === 'menu' && <AccountButton />}
    </div>
  );
}

function PauseStat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="glass min-w-0 rounded-2xl px-1.5 py-3">
      <div className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.15em] text-white/45">{label}</div>
      <div className="font-display mt-1 text-xl font-bold tabular-nums leading-none">
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-semibold text-white/50">{unit}</span>}
      </div>
      <div className="mt-1 h-3 text-[10px] font-semibold leading-3 text-[#f7d354]">{note}</div>
    </div>
  );
}
