import type { CelestialBodyConfig, AudioStem, BodyDistance } from '../types';
import {
  MAX_CONCURRENT_STEMS,
  STEM_PREFETCH_MULTIPLIER,
  DEEP_SPACE_DRONE_MAX_GAIN,
  CROSSFADE_TIME_CONSTANT,
  DRONE_CROSSFADE_TIME_CONSTANT,
  STEM_RETRY_COOLDOWN_MS,
  STEM_MAX_RETRIES,
  STEM_EVICTION_DELAY_MS,
  STEM_DELAY_SECONDS,
  DELAYED_STEM_FADE_IN_TIME_CONSTANT,
  PAN_CENTER_BLEED,
  PANNER_SMOOTH_TIME_CONSTANT,
  MASTER_VOLUME_SMOOTH_TIME_CONSTANT,
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
  // While sim time is scrubbing (not live), stem GAINS keep tracking the
  // scene (audio always matches what's on screen), but we stop starting NEW
  // stems and delay-layer countdowns — fast-moving bodies sweeping through
  // audibility radii would otherwise pop layers in and out chaotically.
  private scrubbing = false;

  // Body positions for spatial audio (updated each frame)
  private bodyPositions: Map<string, [number, number, number]> = new Map();

  // Last gain target per stem — skip rescheduling when target hasn't changed meaningfully
  private scheduledGains: Map<string, number> = new Map();

  // Stems the user has muted from the info panel (keyed by stem id). Muted
  // stems are forced to 0 gain regardless of distance until unmuted.
  private mutedStems: Set<string> = new Set();

  // When set, only this body's stems play — all others duck to silence. Set
  // while the camera is orbiting/focused on a body so a focused planet is heard
  // alone (no bleed from neighbors or the Sun).
  private focusedBodyId: string | null = null;

  // Arrival tracking for delayed stems: ctx.currentTime when a body most recently became
  // audible, and the set of bodies currently audible (to detect the not-audible -> audible edge).
  private bodyArrivalTime: Map<string, number> = new Map();
  private audibleBodies: Set<string> = new Set();

  /**
   * Must be called from a user gesture (click/tap) due to browser autoplay policy.
   */
  async init(): Promise<void> {
    if (this.ctx) return;

    // iOS: route audio through the "media" category so the hardware mute
    // switch does NOT silence playback. Playing a silent <audio> element
    // synchronously inside the user gesture promotes the page off the
    // ringer/notification category. Without this, iPhones with mute on
    // produce no sound even though the AudioContext is running.
    this.unlockIOSAudioCategory();

    this.ctx = new AudioContext({ latencyHint: 'playback' });

    // iOS: AudioContext starts in 'suspended' state. resume() MUST be called
    // synchronously inside the gesture stack — a deferred resume from the
    // animation loop is rejected by Safari's autoplay policy.
    this.ctx.resume().catch(() => {});

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);

    this.initDeepSpaceDrone();
    this.started = true;
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
   * Deep space ambient: low, distorted pink noise.
   * Fades UP when the camera is far from all bodies.
   *
   * Pink noise (equal energy per octave) reads as a warm rushing bed rather
   * than the harsh hiss of white noise; a waveshaper adds grit, and a low
   * lowpass keeps the whole thing dark and sub-heavy. A slow LFO drifts the
   * cutoff so the bed breathes instead of sitting static.
   */
  private initDeepSpaceDrone(): void {
    if (!this.ctx || !this.masterGain) return;

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.masterGain);

    // Generate a few seconds of pink noise (Paul Kellet's economical filter)
    const bufferSize = this.ctx.sampleRate * 4;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    // Drive into a waveshaper for distortion/saturation
    const drive = this.ctx.createGain();
    drive.gain.value = 2.4;

    const shaper = this.ctx.createWaveShaper();
    const k = 45; // distortion amount
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * Math.PI) / (180 * (Math.PI + k * Math.abs(x)));
    }
    shaper.curve = curve;
    shaper.oversample = '4x';

    // Keep it low and dark
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 320;
    lowpass.Q.value = 0.7;

    const bedGain = this.ctx.createGain();
    bedGain.gain.value = 0.5;

    noiseSource.connect(drive);
    drive.connect(shaper);
    shaper.connect(lowpass);
    lowpass.connect(bedGain);
    bedGain.connect(this.droneGain);
    noiseSource.start();
    this.droneNodes.push(noiseSource);

    // Slow cutoff drift so the bed shifts and breathes
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.04;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain);
    lfoGain.connect(lowpass.frequency);
    lfo.start();
    this.droneNodes.push(lfo);
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

      if (distanceKm < prefetchRadius && !this.scrubbing) {
        this.ensureStemsLoaded(config);
      }

      // Arrival edge detection: (re)start the delay-layer countdown each time a body
      // transitions from not-audible to audible, so leaving and coming back resets it.
      const isAudible = distanceKm < config.audibilityRadiusKm;
      if (isAudible && !this.audibleBodies.has(bodyId)) {
        this.audibleBodies.add(bodyId);
        this.bodyArrivalTime.set(bodyId, this.ctx.currentTime);
      } else if (!isAudible && this.audibleBodies.has(bodyId)) {
        this.audibleBodies.delete(bodyId);
      }
      if (!this.scrubbing) this.startDueDelayedStems(bodyId);

      // Focus duck: while orbiting a body, everything else fades to silence.
      const focusMuted = this.focusedBodyId !== null && bodyId !== this.focusedBodyId;

      if (isAudible && stemBudget > 0 && !focusMuted) {
        const targetGain = this.calculateGain(distanceKm, config);
        this.setStemGains(bodyId, targetGain);
        if (targetGain > 0.001) {
          stemBudget -= config.stems.length + (config.delayedStems?.length ?? 0);
        }
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

    // Small floor so deep space is never dead silent, but low enough that the
    // bed recedes when you're close to a body with its own stems.
    const target = (0.12 + 0.88 * closestNormalized) * DEEP_SPACE_DRONE_MAX_GAIN;

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

    const now = performance.now();

    const entries: { url: string; isDelayed: boolean }[] = [
      ...config.stems.map((url) => ({ url, isDelayed: false })),
      ...(config.delayedStems ?? []).map((url) => ({ url, isDelayed: true })),
    ];

    for (const { url, isDelayed } of entries) {
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
        centerGain: null,
        state: 'loading',
        url: this.audioBasePath + url,
        lastActiveTime: now,
        failedAt: 0,
        retryCount: 0,
        isDelayed,
        started: false,
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

      // Center-bleed: a small un-panned copy so the quiet ear never hits zero.
      stem.centerGain = this.ctx.createGain();
      stem.centerGain.gain.value = PAN_CENTER_BLEED;
      stem.centerGain.connect(stem.gainNode);

      // Chain: source -> panner -> gain -> master, with source -> center -> gain
      stem.pannerNode.connect(stem.gainNode);
      stem.gainNode.connect(this.masterGain);

      // Delayed stems (from a body's delay/ folder) don't start playing yet — their
      // BufferSource is created later by startDueDelayedStems() once the countdown
      // elapses. Decoding eagerly here just hides that latency ahead of time.
      if (stem.isDelayed) {
        stem.state = 'ready';
      } else {
        // Create and start looping source
        const source = this.ctx.createBufferSource();
        source.buffer = stem.buffer;
        source.loop = true;
        source.connect(stem.pannerNode);
        if (stem.centerGain) source.connect(stem.centerGain);
        source.start();
        stem.source = source;
        stem.started = true;
        stem.state = 'ready';
      }
    } catch (err) {
      console.warn(`Stem decode failed for ${stem.url}:`, err);
      stem.state = 'failed';
      stem.failedAt = performance.now();
    }
  }

  /**
   * Start any delay-layer stems for a body whose STEM_DELAY_SECONDS countdown has elapsed
   * since arrival. Called every frame; no-ops until there's something due.
   */
  private startDueDelayedStems(bodyId: string): void {
    if (!this.ctx) return;
    const arrivalTime = this.bodyArrivalTime.get(bodyId);
    if (arrivalTime === undefined) return;
    if (this.ctx.currentTime - arrivalTime < STEM_DELAY_SECONDS) return;

    for (const [, stem] of this.stems) {
      if (stem.bodyId !== bodyId || !stem.isDelayed || stem.started || stem.state !== 'ready') continue;
      this.startDelayedStemSource(stem);
    }
  }

  /**
   * Create and start the BufferSource for a delayed stem, fading in from silence so the
   * layer joining mid-orbit doesn't pop in at whatever gain the body is currently mixed at.
   */
  private startDelayedStemSource(stem: AudioStem): void {
    if (!this.ctx || !stem.buffer || !stem.pannerNode || !stem.gainNode) return;

    const source = this.ctx.createBufferSource();
    source.buffer = stem.buffer;
    source.loop = true;
    source.connect(stem.pannerNode);
    if (stem.centerGain) source.connect(stem.centerGain);
    source.start();
    stem.source = source;
    stem.started = true;

    const now = this.ctx.currentTime;
    const target = this.scheduledGains.get(stem.id) ?? 0;
    stem.gainNode.gain.cancelScheduledValues(now);
    stem.gainNode.gain.setValueAtTime(0, now);
    stem.gainNode.gain.setTargetAtTime(target, now, DELAYED_STEM_FADE_IN_TIME_CONSTANT);
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

      // Muted stems are held at silence but kept alive (not evicted) so the
      // user can unmute instantly without a reload.
      const muted = this.mutedStems.has(stemId);
      const effTarget = muted ? 0 : targetGain;

      if (targetGain > 0.001 || muted) stem.lastActiveTime = perfNow;

      // Skip rescheduling if target hasn't changed — avoids micro-discontinuities
      // from cancelScheduledValues interrupting in-flight exponential curves every frame
      const prev = this.scheduledGains.get(stemId) ?? -1;
      if (Math.abs(prev - effTarget) < 0.004) continue;

      this.scheduledGains.set(stemId, effTarget);
      stem.gainNode.gain.cancelScheduledValues(now);
      stem.gainNode.gain.setTargetAtTime(effTarget, now, CROSSFADE_TIME_CONSTANT);
    }
  }

  /**
   * Evict stems that have been silent for over 30 seconds.
   * Frees AudioBuffer memory for bodies the camera has moved far from.
   */
  private evictStaleStems(): void {
    const now = performance.now();

    for (const [id, stem] of this.stems) {
      if (stem.state !== 'ready') continue;
      if (now - stem.lastActiveTime < STEM_EVICTION_DELAY_MS) continue;
      if (stem.gainNode && stem.gainNode.gain.value > 0.001) continue;

      // Evict: stop source, disconnect, free buffer
      try { stem.source?.stop(); } catch { /* ignore */ }
      stem.source?.disconnect();
      stem.pannerNode?.disconnect();
      stem.centerGain?.disconnect();
      stem.gainNode?.disconnect();
      stem.source = null;
      stem.pannerNode = null;
      stem.centerGain = null;
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
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const τ = PANNER_SMOOTH_TIME_CONSTANT;
    for (const [, stem] of this.stems) {
      if (!stem.pannerNode || stem.state !== 'ready') continue;
      const pos = this.bodyPositions.get(stem.bodyId);
      if (!pos) continue;

      if (stem.pannerNode.positionX) {
        // setTargetAtTime (not .value=) so a snapping body position never
        // produces a pan click — the pan glides on the audio thread.
        stem.pannerNode.positionX.setTargetAtTime(pos[0], t, τ);
        stem.pannerNode.positionY.setTargetAtTime(pos[1], t, τ);
        stem.pannerNode.positionZ.setTargetAtTime(pos[2], t, τ);
      } else {
        stem.pannerNode.setPosition(pos[0], pos[1], pos[2]);
      }
    }
  }

  /**
   * Live mix readout for a body: one row per loaded stem with its CURRENT
   * gain (the value the audio thread is actually at, mid-crossfade included).
   * Used by the info panel — "what you're hearing and why".
   */
  getMix(
    selectedBodyId: string
  ): { id: string; label: string; gain: number; muted: boolean; body?: string }[] {
    const rows: { id: string; label: string; gain: number; muted: boolean; body?: string }[] = [];
    const AUDIBLE = 0.004;
    for (const [stemId, stem] of this.stems) {
      if (!stem.gainNode) continue;
      const gain = stem.gainNode.gain.value;
      const isSelected = stem.bodyId === selectedBodyId;
      // The selected body shows all its loaded stems (even silent); other bodies
      // appear only while actually audible — so "now playing" matches what you
      // hear (e.g. Earth's stem while looking at the Moon).
      if (!isSelected && gain <= AUDIBLE) continue;
      // 'mercury/3FreudianPad.m4a' -> '3freudianpad'; delay layers marked
      const file = stem.url.split('/').pop() ?? stem.url;
      const base = file.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
      rows.push({
        id: stemId,
        label: stem.isDelayed ? `${base} (late)` : base,
        gain,
        muted: this.mutedStems.has(stemId),
        ...(isSelected ? {} : { body: stem.bodyId }),
      });
    }
    // Selected body's stems first, then nearby bodies loudest-first.
    rows.sort(
      (a, b) =>
        (a.body ? 1 : 0) - (b.body ? 1 : 0) ||
        b.gain - a.gain ||
        a.label.localeCompare(b.label)
    );
    return rows;
  }

  /**
   * Toggle mute for a single stem (from the info panel). Applied immediately so
   * the click feels instant even if the body isn't being re-mixed this frame.
   */
  toggleStemMute(stemId: string): void {
    const muted = !this.mutedStems.has(stemId);
    if (muted) this.mutedStems.add(stemId);
    else this.mutedStems.delete(stemId);

    const stem = this.stems.get(stemId);
    if (!this.ctx || !stem?.gainNode) return;
    if (muted) {
      // Ramp to silence now.
      stem.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      stem.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, CROSSFADE_TIME_CONSTANT);
      this.scheduledGains.set(stemId, 0);
    } else {
      // Force setStemGains to re-ramp up to the live distance target next frame.
      this.scheduledGains.delete(stemId);
    }
  }

  /**
   * Force-load a body's stems now, regardless of distance or scrubbing. Called
   * when the user flies to a body so its audio can be decoded during the trip.
   */
  prefetchBody(config: CelestialBodyConfig): void {
    if (!this.ctx || !this.started) return;
    this.ensureStemsLoaded(config);
  }

  /**
   * True once every primary (non-delayed) stem for a body is decoded and ready
   * — or there's nothing to load. Stems that failed permanently count as ready
   * so a missing file never stalls an arrival. Used to gate focus travel so the
   * camera doesn't reach a body before its audio does.
   */
  stemsReady(config: CelestialBodyConfig): boolean {
    // Before the audio context exists (pre-gesture) nothing can load — don't stall.
    if (!this.ctx || !this.started) return true;
    for (const url of config.stems) {
      const stem = this.stems.get(`${config.id}:${url}`);
      if (!stem) return false;
      if (stem.state !== 'ready' && stem.state !== 'permanently-failed') return false;
    }
    return true;
  }

  /** Current deep-space drone level (0..DEEP_SPACE_DRONE_MAX_GAIN). */
  getDroneLevel(): number {
    return this.droneGain?.gain.value ?? 0;
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

  /**
   * Called when sim-time scrubbing starts/stops. While scrubbing, existing
   * stems keep mixing by distance (audio matches the scene) but no new stems
   * or delay layers start — prevents churn from fast-orbiting bodies.
   */
  setTimeDilation(active: boolean): void {
    this.scrubbing = active;
  }

  /**
   * Set the body the camera is focused on (or null in free flight). While set,
   * every other body's stems duck to silence so the focused planet plays alone.
   */
  setFocusedBody(bodyId: string | null): void {
    this.focusedBodyId = bodyId;
  }

  setMasterVolume(volume: number): void {
    if (!this.masterGain || !this.ctx) return;
    const v = Math.max(0, Math.min(1, volume));
    // Smooth so slider drags don't zipper the whole mix.
    this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, MASTER_VOLUME_SMOOTH_TIME_CONSTANT);
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
