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
  state: 'unloaded' | 'loading' | 'ready' | 'failed' | 'evicted';
  url: string;
  lastActiveTime: number; // performance.now() when gain was last > 0
}

export interface NavigationMode {
  type: 'free-flight' | 'smooth-journey' | 'focus-travel';
}

export interface HUDSettings {
  showLabels: boolean;
  showDistance: boolean;
  showMiniMap: boolean;
  showInfoPanel: boolean;
  showAudioViz: boolean;
}

export interface AppState {
  navigationMode: NavigationMode;
  hudSettings: HUDSettings;
  selectedBody: string | null;
  cameraPositionKm: [number, number, number];
  timeScale: number; // 1.0 = realtime
  paused: boolean;
}
