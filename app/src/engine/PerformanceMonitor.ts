/**
 * PerformanceMonitor tracks frame time, FPS, and resource counts.
 * Provides a debug overlay when enabled.
 */
export class PerformanceMonitor {
  private frameTimes: number[] = [];
  private lastFrameTime = 0;
  private el: HTMLDivElement | null = null;
  private visible = false;

  // Resource counts (updated externally)
  private stats = {
    fps: 0,
    frameTimeMs: 0,
    activeStems: 0,
    loadedStems: 0,
    activeBodies: 0,
    texturesLoaded: 0,
  };

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'perf-monitor';
    this.el.style.cssText = `
      position: fixed;
      top: 20px; left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.7);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      z-index: 20;
      pointer-events: none;
      display: none;
      white-space: pre;
    `;
    document.body.appendChild(this.el);
  }

  /**
   * Call at the start of each frame.
   */
  beginFrame(): void {
    this.lastFrameTime = performance.now();
  }

  /**
   * Call at the end of each frame.
   */
  endFrame(): void {
    const frameTime = performance.now() - this.lastFrameTime;
    this.frameTimes.push(frameTime);

    // Keep last 60 frames
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Calculate averages
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.stats.frameTimeMs = Math.round(avg * 10) / 10;
    this.stats.fps = Math.round(1000 / avg);

    // Update display every 10 frames
    if (this.visible && this.frameTimes.length % 10 === 0) {
      this.updateDisplay();
    }
  }

  setResourceCounts(counts: {
    activeStems?: number;
    loadedStems?: number;
    activeBodies?: number;
    texturesLoaded?: number;
  }): void {
    if (counts.activeStems !== undefined) this.stats.activeStems = counts.activeStems;
    if (counts.loadedStems !== undefined) this.stats.loadedStems = counts.loadedStems;
    if (counts.activeBodies !== undefined) this.stats.activeBodies = counts.activeBodies;
    if (counts.texturesLoaded !== undefined) this.stats.texturesLoaded = counts.texturesLoaded;
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.el) {
      this.el.style.display = this.visible ? 'block' : 'none';
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.el) {
      this.el.style.display = visible ? 'block' : 'none';
    }
  }

  private updateDisplay(): void {
    if (!this.el) return;
    const s = this.stats;
    this.el.textContent =
      `FPS: ${s.fps}  Frame: ${s.frameTimeMs}ms\n` +
      `Stems: ${s.activeStems}/${s.loadedStems}  Bodies: ${s.activeBodies}\n` +
      `Textures: ${s.texturesLoaded}`;
  }

  getStats() {
    return { ...this.stats };
  }
}
