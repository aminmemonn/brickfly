export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  music: boolean;
  sfx: boolean;
}

export interface QualityPreset {
  /** Half-extent of the near-field brick grid, in cells. */
  fieldN: number;
  /** Half-extent within which studs are instanced. 0 disables studs. */
  studN: number;
  /** Half-extent of translucent water tiles. */
  waterN: number;
  shadows: boolean;
  maxDpr: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { fieldN: 20, studN: 0, waterN: 8, shadows: false, maxDpr: 1 },
  medium: { fieldN: 30, studN: 16, waterN: 10, shadows: false, maxDpr: 1.5 },
  high: { fieldN: 44, studN: 26, waterN: 13, shadows: true, maxDpr: 2 }
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
