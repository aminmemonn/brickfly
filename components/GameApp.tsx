'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { bus } from '@/game/bus';
import { createGame, getGame } from '@/game/game';
import { DEFAULT_SETTINGS, Settings, loadSettings, saveSettings } from '@/game/settings';
import LoadingScreen from './LoadingScreen';
import MainMenu from './MainMenu';
import HUD from './HUD';
import SettingsPanel from './SettingsPanel';

type Phase = 'boot' | 'menu' | 'playing' | 'paused';

export default function GameApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>('boot');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [dist, setDist] = useState(0);

  useEffect(() => {
    setSettings(loadSettings());
    if (canvasRef.current) createGame(canvasRef.current);
    const offReady = bus.on('ready', () => setPhase((p) => (p === 'boot' ? 'menu' : p)));
    const offCollection = bus.on('collection', (ids) => setDiscovered(ids as string[]));
    const offHud = bus.on('hud', (d) => setDist(Math.round((d as { dist: number }).dist / 100) / 10));
    return () => {
      offReady();
      offCollection();
      offHud();
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
          <div className="glass-strong w-80 rounded-3xl p-8 text-center">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.3em] text-white/50">Paused</div>
            <h2 className="font-display mb-2 text-3xl font-extrabold tracking-tight">BRICKFLY</h2>
            <p className="mb-6 text-xs text-white/50">{dist.toFixed(1)} km flown this session</p>
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
    </div>
  );
}
