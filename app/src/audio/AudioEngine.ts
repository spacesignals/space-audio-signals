import type { CelestialBodyConfig, AudioStem } from '../types';
import {
  MAX_CONCURRENT_STEMS,
  STEM_PREFETCH_MULTIPLIER,
  DEEP_SPACE_DRONE_MAX_GAIN,
  CROSSFADE_SPEED,
  KM_PER_UNIT,
} from '../data/constants';

/**
 * AudioEngine manages all spatial audio:
 * - Per-body stems with distance-based gain curves
 * - Deep space procedural drone (fades up when far from everything)
 * - Stem lifecycle: prefetch -> decode -> play -> suspend
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private stems: Map<string, AudioStem> = new Map();
  private bodies: CelestialBodyConfig[] = [];
  private droneOscillators: OscillatorNode[] = [];
  private droneGain: GainNode | null = null;
  private audioBasePath = '/audio/';
  private started = false;

  constructor(bodies: CelestialBodyConfig[]) {
    this.bodies = bodies;
  }

  /**
   * Must be called from a user gesture (click/tap) due to browser autoplay policy.
   */
  async init(): Promise<void> {
    if (this.ctx) return;

    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);

    this.initDeepSpaceDrone();
    this.started = true;
  }

  /**
   * Deep space ambient: low-frequency oscillators + filtered noise.
   * Fades UP when the camera is far from all bodies.
   */
  private initDeepSpaceDrone(): void {
    if (!this.ctx || !this.masterGain) return;

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.masterGain);

    // Sub-bass drone
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 40;
    const gain1 = this.ctx.createGain();
    gain1.gain.value = 0.3;
    osc1.connect(gain1);
    gain1.connect(this.droneGain);
    osc1.start();
    this.droneOscillators.push(osc1);

    // Slow LFO modulating the sub
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 10;
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfo.start();
    this.droneOscillators.push(lfo);

    // Filtered noise layer for texture
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.Q.value = 1;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.08;

    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.droneGain);
    noiseSource.start();
  }

  /**
   * Called every frame. Updates all stem gains based on camera distance.
   * @param cameraPositionUnits - Camera position in Three.js units
   * @param bodyPositionsUnits - Map of bodyId -> [x, y, z] in Three.js units
   */
  update(
    cameraPositionUnits: [number, number, number],
    bodyPositionsUnits: Map<string, [number, number, number]>
  ): void {
    if (!this.ctx || !this.started) return;

    // Resume context if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // Calculate distances to all bodies (in km)
    const distances: { bodyId: string; distanceKm: number; config: CelestialBodyConfig }[] = [];

    for (const body of this.bodies) {
      const pos = bodyPositionsUnits.get(body.id);
      if (!pos) continue;

      const dx = cameraPositionUnits[0] - pos[0];
      const dy = cameraPositionUnits[1] - pos[1];
      const dz = cameraPositionUnits[2] - pos[2];
      const distanceUnits = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const distanceKm = distanceUnits * KM_PER_UNIT;

      distances.push({ bodyId: body.id, distanceKm, config: body });
    }

    // Sort by distance (nearest first)
    distances.sort((a, b) => a.distanceKm - b.distanceKm);

    // Update deep space drone: fades up when far from everything
    this.updateDroneGain(distances);

    // Process each body's audio
    let activeCount = 0;
    for (const { bodyId, distanceKm, config } of distances) {
      const prefetchRadius = config.audibilityRadiusKm * STEM_PREFETCH_MULTIPLIER;

      if (distanceKm < prefetchRadius) {
        // Within prefetch range: ensure stems are loaded
        this.ensureStemsLoaded(config);
      }

      if (distanceKm < config.audibilityRadiusKm && activeCount < MAX_CONCURRENT_STEMS) {
        // Within audibility range: calculate and apply gain
        const targetGain = this.calculateGain(distanceKm, config);
        this.setStemGains(bodyId, targetGain);
        if (targetGain > 0.001) activeCount += config.stems.length;
      } else {
        // Out of range: fade to silence
        this.setStemGains(bodyId, 0);
      }
    }
  }

  /**
   * Calculate gain for a body based on distance and its gain curve.
   */
  private calculateGain(distanceKm: number, config: CelestialBodyConfig): number {
    const { audibilityRadiusKm, maxGain, gainCurve, radiusKm } = config;

    if (distanceKm >= audibilityRadiusKm) return 0;
    if (distanceKm <= radiusKm) return maxGain;

    // Normalize: 0 = at surface, 1 = at audibility edge
    const t = (distanceKm - radiusKm) / (audibilityRadiusKm - radiusKm);

    switch (gainCurve) {
      case 'logarithmic':
        // Logarithmic falloff: stays louder longer, then drops
        return maxGain * (1 - Math.log(1 + t * 9) / Math.log(10));
      case 'inverse-square':
        return maxGain / (1 + t * t * 9);
      case 'linear':
      default:
        return maxGain * (1 - t);
    }
  }

  /**
   * Update the deep space drone gain. Louder when far from all bodies.
   */
  private updateDroneGain(
    distances: { distanceKm: number; config: CelestialBodyConfig }[]
  ): void {
    if (!this.droneGain) return;

    // Drone gain is inverse of proximity to any body
    // If close to anything, drone fades out. If far from everything, drone comes in.
    let closestNormalized = 1.0; // 1 = far from everything
    for (const { distanceKm, config } of distances) {
      const normalized = Math.min(distanceKm / config.audibilityRadiusKm, 1.0);
      closestNormalized = Math.min(closestNormalized, normalized);
    }

    // Smoothly approach target
    const target = closestNormalized * DEEP_SPACE_DRONE_MAX_GAIN;
    const current = this.droneGain.gain.value;
    const diff = target - current;
    this.droneGain.gain.value = current + diff * CROSSFADE_SPEED;
  }

  /**
   * Ensure all stems for a body are loaded and decoded.
   */
  private async ensureStemsLoaded(config: CelestialBodyConfig): Promise<void> {
    if (!this.ctx) return;

    const stemUrls = config.stems.length > 0
      ? config.stems
      : []; // Pool-based loading would go here in Phase 2

    for (const url of stemUrls) {
      const stemId = `${config.id}:${url}`;
      const existing = this.stems.get(stemId);
      if (existing && existing.state !== 'unloaded') continue;

      const stem: AudioStem = {
        id: stemId,
        bodyId: config.id,
        buffer: null,
        source: null,
        gainNode: null,
        state: 'loading',
        url: this.audioBasePath + url,
      };
      this.stems.set(stemId, stem);

      // Load async, don't block the frame
      this.loadStem(stem).catch(() => {
        // Error handling: skip stem, keep playing others
        stem.state = 'unloaded';
        console.warn(`Failed to load stem: ${stem.url}`);
      });
    }
  }

  /**
   * Fetch, decode, and prepare a stem for playback.
   */
  private async loadStem(stem: AudioStem): Promise<void> {
    if (!this.ctx || !this.masterGain) return;

    try {
      const response = await fetch(stem.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const arrayBuffer = await response.arrayBuffer();
      stem.buffer = await this.ctx.decodeAudioData(arrayBuffer);

      // Create gain node
      stem.gainNode = this.ctx.createGain();
      stem.gainNode.gain.value = 0;
      stem.gainNode.connect(this.masterGain);

      // Create and start looping source
      const source = this.ctx.createBufferSource();
      source.buffer = stem.buffer;
      source.loop = true;
      source.connect(stem.gainNode);
      source.start();
      stem.source = source;

      stem.state = 'ready';
    } catch (err) {
      console.warn(`Stem decode failed for ${stem.url}:`, err);
      stem.state = 'unloaded';
    }
  }

  /**
   * Smoothly crossfade all stems for a body to the target gain.
   */
  private setStemGains(bodyId: string, targetGain: number): void {
    for (const [, stem] of this.stems) {
      if (stem.bodyId !== bodyId || !stem.gainNode) continue;

      const current = stem.gainNode.gain.value;
      const diff = targetGain - current;
      // Smooth crossfade
      stem.gainNode.gain.value = current + diff * CROSSFADE_SPEED;
    }
  }

  setMasterVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  dispose(): void {
    for (const osc of this.droneOscillators) {
      try { osc.stop(); } catch { /* ignore */ }
    }
    for (const [, stem] of this.stems) {
      try { stem.source?.stop(); } catch { /* ignore */ }
    }
    this.ctx?.close();
    this.ctx = null;
    this.stems.clear();
  }
}
