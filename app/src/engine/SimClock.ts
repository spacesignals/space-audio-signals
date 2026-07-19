/** Smoothstep easing (zero 1st derivative at both ends). */
function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Time rates in sim-seconds per real second. Symmetric around live (1×).
 * Index into TIME_RATES via SimClock.rateIndex.
 */
export const TIME_RATES: { rate: number; label: string }[] = [
  { rate: -2_592_000, label: '−1 mo/s' },
  { rate: -604_800, label: '−1 wk/s' },
  { rate: -86_400, label: '−1 day/s' },
  { rate: -3_600, label: '−1 hr/s' },
  { rate: -60, label: '−1 min/s' },
  { rate: 1, label: '1×' },
  { rate: 60, label: '1 min/s' },
  { rate: 3_600, label: '1 hr/s' },
  { rate: 86_400, label: '1 day/s' },
  { rate: 604_800, label: '1 wk/s' },
  { rate: 2_592_000, label: '1 mo/s' },
];

export const LIVE_RATE_INDEX = TIME_RATES.findIndex((r) => r.rate === 1);

/** ±100 years — astronomy-engine's comfortable accuracy envelope. */
const CLAMP_MS = 100 * 365.25 * 86_400_000;

/** How long the LIVE snap-back easing takes (seconds). */
const GO_LIVE_EASE_S = 1.2;

/**
 * SimClock owns simulation time for the whole app. While `live`, sim time is
 * pinned to the wall clock. Scrubbing sets a rate multiplier; returning to
 * live *eases* sim time back to now (smoothstep over ~1.2s) so planets slide
 * along their orbits instead of teleporting.
 *
 * Pure logic — the wall clock is injectable for tests.
 */
export class SimClock {
  private simMs: number;
  private live = true;
  private rateIndex = LIVE_RATE_INDEX;
  private now: () => number;

  // goLive easing state
  private easing = false;
  private easeElapsed = 0;
  private easeOffset0 = 0;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
    this.simMs = now();
  }

  /** Advance the clock. dt is REAL seconds since last frame. */
  tick(dt: number): void {
    const wall = this.now();

    if (this.easing) {
      this.easeElapsed += dt;
      const t = Math.min(this.easeElapsed / GO_LIVE_EASE_S, 1);
      this.simMs = wall + this.easeOffset0 * (1 - smoothstep01(t));
      if (t >= 1) {
        this.easing = false;
        this.live = true;
        this.rateIndex = LIVE_RATE_INDEX;
      }
      return;
    }

    if (this.live) {
      this.simMs = wall;
      return;
    }

    this.simMs += dt * 1000 * TIME_RATES[this.rateIndex].rate;
    // Clamp to ±100 years around now
    const min = wall - CLAMP_MS;
    const max = wall + CLAMP_MS;
    if (this.simMs < min) this.simMs = min;
    if (this.simMs > max) this.simMs = max;
  }

  /** Step the rate through the table. dir: +1 faster forward, −1 toward/into reverse. */
  stepRate(dir: 1 | -1): void {
    const next = Math.min(Math.max(this.rateIndex + dir, 0), TIME_RATES.length - 1);
    if (next === this.rateIndex && !this.live) return;
    this.rateIndex = next;
    this.live = false;
    this.easing = false;
  }

  /** Ease sim time back to the wall clock, then pin live. */
  goLive(): void {
    if (this.live && !this.easing) return;
    this.easeOffset0 = this.simMs - this.now();
    this.easeElapsed = 0;
    // Tiny offsets don't need the full easing ceremony
    if (Math.abs(this.easeOffset0) < 2000) {
      this.easing = false;
      this.live = true;
      this.rateIndex = LIVE_RATE_INDEX;
      this.simMs = this.now();
      return;
    }
    this.easing = true;
    this.live = false;
  }

  getSimMs(): number {
    return this.simMs;
  }

  getDate(): Date {
    return new Date(this.simMs);
  }

  /** True when pinned to (or easing back toward) the wall clock. */
  isLive(): boolean {
    return this.live;
  }

  isEasing(): boolean {
    return this.easing;
  }

  getRate(): number {
    return TIME_RATES[this.rateIndex].rate;
  }

  getRateLabel(): string {
    if (this.live) return 'live';
    if (this.easing) return 'returning';
    return TIME_RATES[this.rateIndex].label;
  }
}
