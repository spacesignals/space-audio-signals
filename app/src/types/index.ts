// All distances in kilometers (matching astronomy-engine output)

export interface CelestialBodyConfig {
  id: string;
  name: string;
  type: 'star' | 'planet' | 'dwarf-planet' | 'moon';
  parentId?: string; // e.g., moons orbit a planet
  radiusKm: number;
  // Audio
  audibilityRadiusKm: number;
  maxGain: number;
  gainCurve: 'logarithmic' | 'linear' | 'inverse-square';
  stems: string[]; // file paths relative to /audio/
  delayedStems?: string[]; // file paths relative to /audio/, e.g. 'sun/delay/second-layer.m4a' —
  // starts STEM_DELAY_SECONDS after the body becomes audible, then fades in (see AudioEngine)
  pool?: string; // shared audio pool name if no unique stems
  // Visual
  textureFile?: string; // relative to /textures/
  color?: string; // fallback hex color if no texture
  identityColor?: string; // signature hue shared by orbit line, label, and HUD accent
  emissive?: boolean; // true for Sun
  hasRings?: boolean;
  ringInnerRadiusKm?: number;
  ringOuterRadiusKm?: number;
  atmosphereColor?: string;
  atmosphereIntensity?: number; // 0..1 — scaled to the real atmosphere's prominence
}

export interface AudioStem {
  id: string;
  bodyId: string;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  pannerNode: PannerNode | null;
  state: 'unloaded' | 'loading' | 'ready' | 'failed' | 'permanently-failed' | 'evicted';
  url: string;
  lastActiveTime: number; // performance.now() when gain was last > 0
  failedAt: number; // performance.now() when last failure occurred
  retryCount: number; // number of retry attempts after first failure
  isDelayed: boolean; // true if this stem came from a body's delay/ folder
  started: boolean; // true once the BufferSource has been created and started
}

/** Pre-computed distance from camera to a body, shared across systems. */
export interface BodyDistance {
  bodyId: string;
  distanceKm: number;
  config: CelestialBodyConfig;
}
