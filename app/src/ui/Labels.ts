import * as THREE from 'three';
import type { CelestialBodyConfig } from '../types';
import { KM_PER_UNIT, BODY_VISUAL_SCALE, SUN_VISUAL_SCALE } from '../data/constants';
import { MOON_ORBITS } from '../data/bodies';

/** Priority classes: lower wins overlap contests. */
function bodyPriority(type: CelestialBodyConfig['type']): number {
  switch (type) {
    case 'star': return 0;
    case 'planet': return 1;
    case 'dwarf-planet': return 2;
    default: return 3; // moons
  }
}

export interface LabelRect {
  id: string;
  priority: number;
  distance: number;
  x: number; // screen center x
  y: number; // screen top y
  w: number;
  h: number;
}

/**
 * Overlap resolution: keep the higher-priority label when two collide in
 * screen space (planet > moon; nearer wins ties). Returns hidden ids.
 * Pure — exported for tests.
 */
export function resolveLabelOverlaps(rects: LabelRect[]): Set<string> {
  const hidden = new Set<string>();
  const sorted = [...rects].sort(
    (a, b) => a.priority - b.priority || a.distance - b.distance
  );
  const kept: LabelRect[] = [];
  for (const r of sorted) {
    const collides = kept.some(
      (k) =>
        Math.abs(k.x - r.x) < (k.w + r.w) / 2 &&
        Math.abs(k.y - r.y) < (k.h + r.h) / 2
    );
    if (collides) hidden.add(r.id);
    else kept.push(r);
  }
  return hidden;
}

const CSS = `
#body-labels {
  position: fixed; inset: 0; overflow: hidden;
  pointer-events: none; z-index: 9;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.body-label {
  position: absolute; left: 0; top: 0;
  transform: translate(-50%, -100%);
  font-size: 10px; letter-spacing: 3px; text-transform: lowercase;
  white-space: nowrap; cursor: pointer; pointer-events: auto;
  text-shadow: 0 0 6px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.9);
  /* Resting state: a deep grey whisper, barely legible. Hovering lifts the
     label to its body's identity color at full brightness. */
  color: #4a4a4a;
  opacity: 0; transition: opacity 0.45s ease, color 0.3s ease, filter 0.3s ease;
  will-change: transform;
  padding: 3px 5px; /* generous hit target without visual weight */
}
.body-label:hover { color: var(--hue, #c8c8c8); filter: brightness(1.35); }
`;

interface LabelEntry {
  config: CelestialBodyConfig;
  el: HTMLDivElement;
  priority: number;
  visualRadius: number;
  width: number; // measured once after mount
  targetOpacity: number;
  baseOpacity: number;
  proximityFade: number; // 1 normally; -> 0 as the body grows to fill the view
}

/**
 * Screen-space HTML labels, Eyes on the Solar System style: constant pixel
 * size at any zoom, colored by the body's identityColor (same hue as its
 * orbit line), clickable to fly there. Sun/planets/dwarfs always labeled;
 * moons only when the camera is inside the parent's neighborhood.
 */
export class Labels {
  private container: HTMLDivElement;
  private entries: LabelEntry[] = [];
  private visible = true;
  private onPick: (bodyId: string) => void;
  private _pos = new THREE.Vector3();
  private _parentPos = new THREE.Vector3();

  constructor(onPick: (bodyId: string) => void) {
    this.onPick = onPick;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.container = document.createElement('div');
    this.container.id = 'body-labels';
    document.body.appendChild(this.container);
  }

  init(bodies: CelestialBodyConfig[]): void {
    for (const config of bodies) {
      const el = document.createElement('div');
      el.className = 'body-label';
      el.textContent = config.name.toLowerCase();
      // Identity color lives in a CSS var so the resting grey can win until hover
      el.style.setProperty('--hue', config.identityColor ?? '#c8c8c8');
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onPick(config.id);
      });
      this.container.appendChild(el);

      const scale = config.type === 'star' ? SUN_VISUAL_SCALE : BODY_VISUAL_SCALE;
      const priority = bodyPriority(config.type);
      this.entries.push({
        config,
        el,
        priority,
        visualRadius: (config.radiusKm / KM_PER_UNIT) * scale,
        width: el.offsetWidth || config.name.length * 9,
        targetOpacity: 0,
        // planets carry the map; moons and small bodies whisper
        baseOpacity: priority <= 1 ? 0.88 : priority === 2 ? 0.72 : 0.68,
        proximityFade: 1,
      });
    }
  }

  /**
   * Per-frame: project each body to screen space, gate moons by parent
   * neighborhood, resolve overlaps, and position via transform (no layout).
   */
  update(
    camera: THREE.PerspectiveCamera,
    positions: Map<string, [number, number, number]>
  ): void {
    if (!this.visible) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const halfH = h / 2;
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);

    const rects: LabelRect[] = [];
    const screenData = new Map<string, { x: number; y: number }>();

    for (const entry of this.entries) {
      const p = positions.get(entry.config.id);
      if (!p) { entry.targetOpacity = 0; continue; }

      // Moon gate: only label moons when the camera is near the parent system
      if (entry.config.parentId) {
        const pp = positions.get(entry.config.parentId);
        const orbit = MOON_ORBITS[entry.config.id];
        const orbitR = orbit ? (orbit.semiMajorAxisKm / KM_PER_UNIT) * BODY_VISUAL_SCALE : 0;
        if (pp) {
          const distToParent = this._parentPos.set(pp[0], pp[1], pp[2]).distanceTo(camera.position);
          const parentEntry = this.entries.find(e => e.config.id === entry.config.parentId);
          const neighborhood = Math.max((parentEntry?.visualRadius ?? 0.1) * 40, orbitR * 2.5);
          if (distToParent > neighborhood) { entry.targetOpacity = 0; continue; }
        }
      }

      this._pos.set(p[0], p[1], p[2]);
      const dist = this._pos.distanceTo(camera.position);
      this._pos.project(camera);

      // Behind the camera or far outside the frustum edges
      if (this._pos.z > 1 || this._pos.x < -1.15 || this._pos.x > 1.15 ||
          this._pos.y < -1.15 || this._pos.y > 1.15) {
        entry.targetOpacity = 0;
        continue;
      }

      const sx = ((this._pos.x + 1) / 2) * w;
      // Anchor above the body's limb: projected angular radius in pixels
      const radiusPx = dist > 0 ? (entry.visualRadius / dist / tanHalfFov) * halfH : 0;
      const sy = ((1 - this._pos.y) / 2) * h - Math.min(radiusPx, h) - 8;

      // When the body grows large in view (you're looking right at it), let the
      // body sit "in front of" its own name: fade the label as its disk fills
      // the frame, so the text recedes behind the planet instead of over it.
      const fadeStart = h * 0.34;
      const fadeEnd = h * 0.72;
      entry.proximityFade =
        radiusPx <= fadeStart
          ? 1
          : Math.max(0, 1 - (radiusPx - fadeStart) / (fadeEnd - fadeStart));

      screenData.set(entry.config.id, { x: sx, y: sy });
      rects.push({
        id: entry.config.id,
        priority: entry.priority,
        distance: dist,
        x: sx,
        y: sy,
        w: entry.width,
        h: 18,
      });
    }

    const hidden = resolveLabelOverlaps(rects);

    for (const entry of this.entries) {
      const sd = screenData.get(entry.config.id);
      if (!sd || hidden.has(entry.config.id)) {
        if (!sd) { this.applyOpacity(entry, 0); continue; }
        entry.targetOpacity = 0;
      } else {
        entry.targetOpacity = entry.baseOpacity * entry.proximityFade;
      }
      entry.el.style.transform = `translate(-50%, -100%) translate(${sd.x.toFixed(1)}px, ${sd.y.toFixed(1)}px)`;
      this.applyOpacity(entry, entry.targetOpacity);
    }
  }

  private applyOpacity(entry: LabelEntry, value: number): void {
    const current = entry.el.style.opacity;
    const next = value.toFixed(2);
    if (current !== next) {
      entry.el.style.opacity = next;
      // Fully hidden labels shouldn't eat pointer events
      entry.el.style.pointerEvents = value > 0.01 ? 'auto' : 'none';
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.style.display = visible ? '' : 'none';
  }

  /** Re-measure label widths (call once after fonts settle, if needed). */
  remeasure(): void {
    for (const entry of this.entries) {
      const measured = entry.el.offsetWidth;
      if (measured > 0) entry.width = measured;
    }
  }

  dispose(): void {
    this.container.remove();
    this.entries = [];
  }
}
