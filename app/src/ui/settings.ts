/**
 * Persisted user settings — every visual/behavioral mod ships with a toggle
 * (the NASA Eyes "everything is a layer" rule), and all of them survive
 * reloads via localStorage.
 */
export interface AppSettings {
  volume: number;         // 0..100
  bloom: number;          // 0..200
  labels: boolean;
  orbitLines: boolean;
  starField: boolean;
  belts: boolean;         // asteroid + kuiper belt point clouds
  timeBar: boolean;
  floodLighting: boolean; // ambient boost to inspect night sides
  backgroundAudio: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  volume: 100,
  bloom: 100,
  labels: true,
  orbitLines: true,
  starField: true,
  belts: true,
  timeBar: true,
  floodLighting: false,
  backgroundAudio: true,
};

const KEY = 'galaxymusic-settings-v1';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode) — settings just won't persist
  }
  return next;
}
