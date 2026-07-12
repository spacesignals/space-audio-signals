/**
 * AdaptiveResolution — dynamic render-scale governor.
 *
 * Watches real frame times and steps the render pixel ratio down when the
 * device can't hold ~50fps, back up when there's headroom. This is what keeps
 * the experience smooth on phones (DPR 3 screens with modest GPUs) without
 * penalizing desktops.
 */
export class AdaptiveResolution {
  /** Render scale steps applied on top of the base pixel ratio. */
  private static readonly SCALES = [1.0, 0.85, 0.7, 0.55];

  /** Frame-time thresholds (ms). Above SLOW → step down; below FAST → step up. */
  private static readonly SLOW_MS = 22; // ~45fps sustained
  private static readonly FAST_MS = 13; // ~75fps headroom

  /** Frames per evaluation window. */
  private static readonly WINDOW = 90;

  /** Ignore the first seconds — texture uploads and JIT make startup spiky. */
  private static readonly WARMUP_MS = 4000;

  private scaleIndex = 0;
  private frameCount = 0;
  private accumMs = 0;
  private startTime = performance.now();
  private lastChangeTime = 0;

  private baseRatio: number;
  private apply: (pixelRatio: number) => void;

  constructor(baseRatio: number, apply: (pixelRatio: number) => void) {
    this.baseRatio = baseRatio;
    this.apply = apply;
  }

  /** Feed one frame's delta time (seconds). Applies scale changes as needed. */
  tick(deltaSeconds: number): void {
    const now = performance.now();
    if (now - this.startTime < AdaptiveResolution.WARMUP_MS) return;

    // Clamp outliers (tab switches, GC pauses) so one spike can't force a downscale
    const ms = Math.min(deltaSeconds * 1000, 100);
    this.accumMs += ms;
    this.frameCount++;

    if (this.frameCount < AdaptiveResolution.WINDOW) return;

    const avg = this.accumMs / this.frameCount;
    this.frameCount = 0;
    this.accumMs = 0;

    // Brief cooldown after a change so the new scale's cost is measured, not the old one's
    if (now - this.lastChangeTime < 2000) return;

    if (avg > AdaptiveResolution.SLOW_MS && this.scaleIndex < AdaptiveResolution.SCALES.length - 1) {
      this.scaleIndex++;
      this.applyScale(now);
    } else if (avg < AdaptiveResolution.FAST_MS && this.scaleIndex > 0) {
      this.scaleIndex--;
      this.applyScale(now);
    }
  }

  private applyScale(now: number): void {
    this.lastChangeTime = now;
    this.apply(this.baseRatio * AdaptiveResolution.SCALES[this.scaleIndex]);
  }

  getCurrentScale(): number {
    return AdaptiveResolution.SCALES[this.scaleIndex];
  }
}
