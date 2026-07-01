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
  private audioBasePath = `${import.meta.env.BASE_URL}audio/`;
  private started = false;
  private lastEvictionCheck = 0;
  private lastDroneTarget = -1;

  // Body positions for spatial audio (updated each frame)
  private bodyPositions: Map<string, [number, number, number]> = new Map();

  // Last gain target per stem — skip rescheduling when target hasn't changed meaningfully
  private scheduledGains: Map<string, number> = new Map();

  constructor() {}


  /**
   * Must be called from a user gesture (click/tap) due to browser autoplay policy.
   */
  async init(): Promise<void> {
    if (this.ctx) return;
    console.log('[AudioEngine] init() called');

    // iOS: route audio through the "media" category so the hardware mute
    // switch does NOT silence playback. Playing a silent <audio> element
    // synchronously inside the user gesture promotes the page off the
    // ringer/notification category. Without this, iPhones with mute on
    // produce no sound even though the AudioContext is running.
    this.unlockIOSAudioCategory();

    this.ctx = new AudioContext({ latencyHint: 'playback' });
    console.log('[AudioEngine] AudioContext state:', this.ctx.state);

    // iOS: AudioContext starts in 'suspended' state. resume() MUST be called
    // synchronously inside the gesture stack — a deferred resume from the
    // animation loop is rejected by Safari's autoplay policy.
    this.ctx.resume().catch(() => {});

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);

    this.initDeepSpaceDrone();
    this.started = true;
    console.log('[AudioEngine] Drone initialized, started =', this.started);
  }

  /**
   * iOS-only audio category unlock. Plays a tiny inline silent WAV via an
   * <audio playsinline> element. Safari interprets this as media playback
   * (not a notification ping), which routes Web Audio through the media
   * channel — bypassing the hardware silent switch.
   */
  private unlockIOSAudioCategory(): void {
    try {
      // 44-byte WAV header + zero samples = silent, valid, ~100 bytes base64
      const silentWav =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      const el = document.createElement('audio');
      el.src = silentWav;
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.loop = false;
      el.volume = 0;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // ignore — non-iOS browsers don't need this
    }
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
   * Update listener position and orientation for spatial audio.
   * Call each frame with camera state in Three.js units.
   */
  updateListener(
    position: [number, number, number],
    forward: [number, number, number],
    up: [number, number, number]
  ): void {
    if (!this.ctx) return;
    const listener = this.ctx.listener;

    if (listener.positionX) {
      // Modern API (Chrome, Firefox)
      // Use setTargetAtTime (τ=0.05s) instead of .value= to smooth rapid camera
      // movement and mouse-look orientation changes, preventing spatial audio pops.
      const t = this.ctx.currentTime;
      const τ = 0.05;
      listener.positionX.setTargetAtTime(position[0], t, τ);
      listener.positionY.setTargetAtTime(position[1], t, τ);
      listener.positionZ.setTargetAtTime(position[2], t, τ);
      listener.forwardX.setTargetAtTime(forward[0], t, τ);
      listener.forwardY.setTargetAtTime(forward[1], t, τ);
      listener.forwardZ.setTargetAtTime(forward[2], t, τ);
      listener.upX.setTargetAtTime(up[0], t, τ);
      listener.upY.setTargetAtTime(up[1], t, τ);
      listener.upZ.setTargetAtTime(up[2], t, τ);
    } else {
      // Legacy API (Safari)
      listener.setPosition(position[0], position[1], position[2]);
      listener.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    }
  }

  /**
   * Set body positions for spatial panner updates.
   */
  setBodyPositions(positions: Map<string, [number, number, number]>): void {
    this.bodyPositions = positions;
  }

  /**
   * Called every frame. Updates all stem gains and spatial positions based on pre-computed distances.
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

    // Update panner positions for all active stems
    this.updatePannerPositions();

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
        pannerNode: null,
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

      // Create panner for spatial audio
      stem.pannerNode = this.ctx.createPanner();
      stem.pannerNode.panningModel = 'equalpower';
      stem.pannerNode.distanceModel = 'linear';
      stem.pannerNode.maxDistance = 10000;
      stem.pannerNode.refDistance = 1;
      stem.pannerNode.rolloffFactor = 0; // we handle gain ourselves, panner only does directionality
      stem.pannerNode.coneInnerAngle = 360;
      stem.pannerNode.coneOuterAngle = 360;

      // Create gain node
      stem.gainNode = this.ctx.createGain();
      stem.gainNode.gain.value = 0;

      // Chain: source -> panner -> gain -> master
      stem.pannerNode.connect(stem.gainNode);
      stem.gainNode.connect(this.masterGain);

      // Create and start looping source
      const source = this.ctx.createBufferSource();
      source.buffer = stem.buffer;
      source.loop = true;
      source.connect(stem.pannerNode);
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

    for (const [stemId, stem] of this.stems) {
      if (stem.bodyId !== bodyId || !stem.gainNode) continue;

      if (targetGain > 0.001) stem.lastActiveTime = perfNow;

      // Skip rescheduling if target hasn't changed — avoids micro-discontinuities
      // from cancelScheduledValues interrupting in-flight exponential curves every frame
      const prev = this.scheduledGains.get(stemId) ?? -1;
      if (Math.abs(prev - targetGain) < 0.004) continue;

      this.scheduledGains.set(stemId, targetGain);
      stem.gainNode.gain.cancelScheduledValues(now);
      stem.gainNode.gain.setTargetAtTime(targetGain, now, CROSSFADE_TIME_CONSTANT);
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
      stem.pannerNode?.disconnect();
      stem.gainNode?.disconnect();
      stem.source = null;
      stem.pannerNode = null;
      stem.gainNode = null;
      stem.buffer = null;
      stem.state = 'evicted';
      this.stems.delete(id);
    }
  }

  /**
   * Update panner node positions for all active stems based on body positions.
   */
  private updatePannerPositions(): void {
    for (const [, stem] of this.stems) {
      if (!stem.pannerNode || stem.state !== 'ready') continue;
      const pos = this.bodyPositions.get(stem.bodyId);
      if (!pos) continue;

      if (stem.pannerNode.positionX) {
        stem.pannerNode.positionX.value = pos[0];
        stem.pannerNode.positionY.value = pos[1];
        stem.pannerNode.positionZ.value = pos[2];
      } else {
        stem.pannerNode.setPosition(pos[0], pos[1], pos[2]);
      }
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
