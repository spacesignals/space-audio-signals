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
  pool?: string; // shared audio pool name if no unique stems
  // Visual
  textureFile?: string; // relative to /textures/
  color?: string; // fallback hex color if no texture
  emissive?: boolean; // true for Sun
  hasRings?: boolean;
  ringInnerRadiusKm?: number;
  ringOuterRadiusKm?: number;
  atmosphereColor?: string;
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
}

/** Pre-computed distance from camera to a body, shared across systems. */
export interface BodyDistance {
  bodyId: string;
  distanceKm: number;
  config: CelestialBodyConfig;
}
