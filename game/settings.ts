export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  music: boolean;
  sfx: boolean;
}

export interface QualityPreset {
  /** Half-extent of the near-field brick grid, in cells. */
  fieldN: number;
  /** Half-extent of the coarse far-field slab grid, in far cells (4 bricks each). */
  farN: number;
  /** Enables the 200-unit cylinder-to-normal stud LOD. */
  studs: boolean;
  shadows: boolean;
  maxDpr: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { fieldN: 20, farN: 34, studs: false, shadows: false, maxDpr: 1 },
  medium: { fieldN: 30, farN: 42, studs: true, shadows: false, maxDpr: 1.5 },
  high: { fieldN: 44, farN: 50, studs: true, shadows: true, maxDpr: 2 }
};

const KEY = 'brickfly.settings';

export const DEFAULT_SETTINGS: Settings = { quality: 'high', music: true, sfx: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* corrupted or unavailable storage falls back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable in private browsing */
  }
}
