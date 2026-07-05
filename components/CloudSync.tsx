'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { bus } from '@/game/bus';

const DISCOVERED_KEY = 'brickfly.discovered';
const SETTINGS_KEY = 'brickfly.settings';

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function readObj(key: string): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Invisible component that keeps the signed-in player's collection, flight
 * stats and settings synced with the cloud. On sign-in it merges the server's
 * collection with the local one; thereafter it debounce-saves on changes.
 * Does nothing at all when the player is signed out.
 */
export default function CloudSync() {
  const { status } = useSession();
  const collection = useRef<string[]>([]);
  const distKm = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = () => {
    if (status !== 'authenticated') return;
    fetch('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        collection: collection.current,
        stats: { distanceKm: distKm.current, wonders: collection.current.length },
        settings: readObj(SETTINGS_KEY)
      })
    }).catch(() => {});
  };

  const scheduleSave = () => {
    if (status !== 'authenticated') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 1500);
  };

  // Track live game changes regardless of auth state.
  useEffect(() => {
    collection.current = readList(DISCOVERED_KEY);
    const offCol = bus.on('collection', (ids) => {
      collection.current = (ids as string[]) ?? [];
      scheduleSave();
    });
    const offHud = bus.on('hud', (d) => {
      const dist = (d as { dist?: number })?.dist;
      if (typeof dist === 'number') distKm.current = Math.round(dist / 100) / 10;
    });
    return () => {
      offCol();
      offHud();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Pull + merge on sign-in.
  useEffect(() => {
    if (status !== 'authenticated') return;
    let alive = true;
    fetch('/api/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.ok) return;
        const server: string[] = d.state?.collection ?? [];
        const local = readList(DISCOVERED_KEY);
        const merged = Array.from(new Set([...local, ...server]));
        try {
          localStorage.setItem(DISCOVERED_KEY, JSON.stringify(merged));
        } catch {
          /* ignore */
        }
        collection.current = merged;
        // Import server discoveries into the running game so the HUD updates now.
        bus.emit('import-collection', merged);
        // Converge the cloud copy too (covers a first-ever save).
        save();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return null;
}
