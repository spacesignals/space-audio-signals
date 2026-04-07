import type { CelestialBodyConfig, AudioStem, BodyDistance } from '../types';
import {
  MAX_CONCURRENT_STEMS,
  STEM_PREFETCH_MULTIPLIER,
  DEEP_SPACE_DRONE_MAX_GAIN,
  CROSSFADE_TIME_CONSTANT,
  DRONE_CROSSFADE_TIME_CONSTANT,
  STEM_RETRY_COOLDOWN_MS,
  STEM_MAX_RETRIES,
} from '../data/constants';

/**
 * AudioEngine manages all spatial audio:
 * - Per-body stems with distance-based gain curves
 * - Deep space procedural drone (fades up when far from everything)
 * - Stem lifecycle: prefetch -> decode -> play -> evict
 *
 * Gain changes use Web Audio's setTargetAtTime() for frame-rate-independent,
 * sample-accurate crossfades on the audio thread.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private stems: Map<string, AudioStem> = new Map();
  private droneNodes: AudioNode[] = [];
  private droneGain: GainNode | null = null;
  private audioBasePath = '/audio/';
  private started = false;
  private lastEvictionCheck = 0;
  private lastDroneTarget = -1;

  constructor() {}


  /**
   * Must be called from a user gesture (click/tap) due to browser autoplay policy.
   */
  async init(): Promise<void> {
    if (this.ctx) return;
    console.log('[AudioEngine] init() called');

    this.ctx = new AudioContext();
    console.log('[AudioEngine] AudioContext state:', this.ctx.state);
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);

    this.initDeepSpaceDrone();
    this.started = true;
    console.log('[AudioEngine] Drone initialized, started =', this.started);
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
    this.droneNodes.push(osc1);

    // Slow LFO modulating the sub
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 10;
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfo.start();
    this.droneNodes.push(lfo);

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
    this.droneNodes.push(noiseSource);
  }

  /**
   * Called every frame. Updates all stem gains based on pre-computed distances.
   * @param distances - Sorted array of body distances (nearest first), computed by main loop.
   */
  update(distances: BodyDistance[]): void {
    if (!this.ctx || !this.started) return;

    // Resume context if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        // iOS Safari may reject — will retry next frame
      });
    }

    // Update deep space drone: fades up when far from everything
    this.updateDroneGain(distances);

    // Process each body's audio with dynamic stem budget.
    // Distances are sorted nearest-first, so closest bodies get priority.
    let stemBudget = MAX_CONCURRENT_STEMS;
    for (const { bodyId, distanceKm, config } of distances) {
      const prefetchRadius = config.audibilityRadiusKm * STEM_PREFETCH_MULTIPLIER;

      if (distanceKm < prefetchRadius) {
        this.ensureStemsLoaded(config);
      }

      if (distanceKm < config.audibilityRadiusKm && stemBudget > 0) {
        const targetGain = this.calculateGain(distanceKm, config);
        this.setStemGains(bodyId, targetGain);
        if (targetGain > 0.001) stemBudget -= config.stems.length;
      } else {
        this.setStemGains(bodyId, 0);
      }
    }

    // Evict stale stems every 5 seconds
    const now = performance.now();
    if (now - this.lastEvictionCheck > 5000) {
      this.lastEvictionCheck = now;
      this.evictStaleStems();
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
   * Uses setTargetAtTime for frame-rate-independent crossfade.
   */
  private updateDroneGain(
    distances: { distanceKm: number; config: CelestialBodyConfig }[]
  ): void {
    if (!this.droneGain || !this.ctx) return;

    // Drone gain is inverse of proximity to any body
    let closestNormalized = 1.0;
    for (const { distanceKm, config } of distances) {
      const normalized = Math.min(distanceKm / config.audibilityRadiusKm, 1.0);
      closestNormalized = Math.min(closestNormalized, normalized);
    }

    // Minimum 30% drone so there's always ambient sound (no stems loaded yet)
    const target = (0.3 + 0.7 * closestNormalized) * DEEP_SPACE_DRONE_MAX_GAIN;

    // Only schedule if target changed meaningfully (avoid redundant scheduling)
    if (Math.abs(target - this.lastDroneTarget) > 0.001) {
      this.droneGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.droneGain.gain.setTargetAtTime(target, this.ctx.currentTime, DRONE_CROSSFADE_TIME_CONSTANT);
      this.lastDroneTarget = target;
    }
  }

  /**
   * Ensure all stems for a body are loaded and decoded.
   */
  private async ensureStemsLoaded(config: CelestialBodyConfig): Promise<void> {
    if (!this.ctx) return;

    const stemUrls = config.stems.length > 0
      ? config.stems
      : []; // Pool-based loading would go here in Phase 2

    const now = performance.now();

    for (const url of stemUrls) {
      const stemId = `${config.id}:${url}`;
      const existing = this.stems.get(stemId);

      if (existing) {
        // Skip if already loading, ready, or permanently failed
        if (existing.state === 'loading' || existing.state === 'ready' || existing.state === 'permanently-failed') {
          continue;
        }
        // Skip failed stems until cooldown expires
        if (existing.state === 'failed') {
          if (now - existing.failedAt < STEM_RETRY_COOLDOWN_MS) continue;
          if (existing.retryCount >= STEM_MAX_RETRIES) {
            existing.state = 'permanently-failed';
            continue;
          }
          // Retry: increment count and re-load
          existing.retryCount++;
          existing.state = 'loading';
          this.loadStem(existing).catch(() => {
            existing.state = 'failed';
            existing.failedAt = performance.now();
            console.warn(`Retry failed for stem: ${existing.url}`);
          });
          continue;
        }
        // evicted or unloaded: fall through to create new stem
      }

      const stem: AudioStem = {
        id: stemId,
        bodyId: config.id,
        buffer: null,
        source: null,
        gainNode: null,
        state: 'loading',
        url: this.audioBasePath + url,
        lastActiveTime: now,
        failedAt: 0,
        retryCount: 0,
      };
      this.stems.set(stemId, stem);

      // Load async, don't block the frame
      this.loadStem(stem).catch(() => {
        stem.state = 'failed';
        stem.failedAt = performance.now();
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
      stem.state = 'failed';
      stem.failedAt = performance.now();
    }
  }

  /**
   * Schedule gain change for all stems of a body using setTargetAtTime.
   * Runs on the audio thread — frame-rate independent, sample-accurate.
   */
  private setStemGains(bodyId: string, targetGain: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const perfNow = performance.now();

    for (const [, stem] of this.stems) {
      if (stem.bodyId !== bodyId || !stem.gainNode) continue;

      // Only reschedule if target changed meaningfully
      stem.gainNode.gain.cancelScheduledValues(now);
      stem.gainNode.gain.setTargetAtTime(targetGain, now, CROSSFADE_TIME_CONSTANT);

      if (targetGain > 0.001) {
        stem.lastActiveTime = perfNow;
      }
    }
  }

  /**
   * Evict stems that have been silent for over 30 seconds.
   * Frees AudioBuffer memory for bodies the camera has moved far from.
   */
  private evictStaleStems(): void {
    const now = performance.now();
    const EVICT_AFTER_MS = 30_000;

    for (const [id, stem] of this.stems) {
      if (stem.state !== 'ready') continue;
      if (now - stem.lastActiveTime < EVICT_AFTER_MS) continue;
      if (stem.gainNode && stem.gainNode.gain.value > 0.001) continue;

      // Evict: stop source, disconnect, free buffer
      try { stem.source?.stop(); } catch { /* ignore */ }
      stem.source?.disconnect();
      stem.gainNode?.disconnect();
      stem.source = null;
      stem.gainNode = null;
      stem.buffer = null;
      stem.state = 'evicted';
      this.stems.delete(id);
    }
  }

  getActiveStems(): number {
    let count = 0;
    for (const [, stem] of this.stems) {
      if (stem.gainNode && stem.gainNode.gain.value > 0.001) count++;
    }
    return count;
  }

  getLoadedStems(): number {
    let count = 0;
    for (const [, stem] of this.stems) {
      if (stem.state === 'ready') count++;
    }
    return count;
  }

  setMasterVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /** Suspend the AudioContext (pause all audio processing). */
  suspend(): void {
    this.ctx?.suspend().catch(() => {});
  }

  /** Resume the AudioContext after a suspend. */
  resume(): void {
    this.ctx?.resume().catch(() => {});
  }

  dispose(): void {
    for (const node of this.droneNodes) {
      try {
        if (node instanceof OscillatorNode) node.stop();
        if (node instanceof AudioBufferSourceNode) node.stop();
      } catch { /* ignore */ }
    }
    for (const [, stem] of this.stems) {
      try { stem.source?.stop(); } catch { /* ignore */ }
    }
    this.ctx?.close();
    this.ctx = null;
    this.stems.clear();
    this.droneNodes = [];
  }
}
