import * as THREE from 'three';
import * as Astronomy from 'astronomy-engine';
import { KM_PER_UNIT, BODY_VISUAL_SCALE } from '../data/constants';
import { BODIES, MOON_ORBITS, ASTEROID_ORBITS } from '../data/bodies';

const AU_TO_KM = 149_597_870.7;
const MS_PER_DAY = 86_400_000;

// Orbital periods in Earth days for astronomy-engine bodies (used only to pick
// the sampling window for one full revolution — accuracy here is cosmetic).
const PLANET_PERIOD_DAYS: Record<string, number> = {
  mercury: 88, venus: 224.7, earth: 365.25, mars: 687,
  jupiter: 4333, saturn: 10759, uranus: 30687, neptune: 60190, pluto: 90560,
};

const ASTRO_BODY: Record<string, Astronomy.Body> = {
  mercury: Astronomy.Body.Mercury, venus: Astronomy.Body.Venus,
  earth: Astronomy.Body.Earth, mars: Astronomy.Body.Mars,
  jupiter: Astronomy.Body.Jupiter, saturn: Astronomy.Body.Saturn,
  uranus: Astronomy.Body.Uranus, neptune: Astronomy.Body.Neptune,
  pluto: Astronomy.Body.Pluto,
};

const PLANET_SEGMENTS = 256;
const CIRCLE_SEGMENTS = 128;
// Barely-visible guides: the map should whisper, not draw over the planets
const PLANET_OPACITY = 0.10;
const MOON_OPACITY = 0.07;
const ASTEROID_OPACITY = 0.05;

/**
 * Sample the parametric circular-with-inclination orbit used by
 * Ephemeris.updateCircularOrbits so the drawn line matches the actual path.
 * Exported for tests.
 */
export function sampleAsteroidOrbit(
  semiMajorAxisAU: number,
  inclinationDeg: number,
  segments: number
): Float32Array {
  const r = (semiMajorAxisAU * AU_TO_KM) / KM_PER_UNIT;
  const inc = (inclinationDeg * Math.PI) / 180;
  const out = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = Math.sin(inc) * Math.sin(a) * r;
    out[i * 3 + 2] = Math.sin(a) * r * Math.cos(inc);
  }
  return out;
}

/** Flat circle in the ecliptic plane (moon guide orbits). Exported for tests. */
export function sampleCircleOrbit(radiusUnits: number, segments: number): Float32Array {
  const out = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out[i * 3] = Math.cos(a) * radiusUnits;
    out[i * 3 + 1] = 0;
    out[i * 3 + 2] = Math.sin(a) * radiusUnits;
  }
  return out;
}

interface OrbitLine {
  line: THREE.LineLoop;
  material: THREE.ShaderMaterial;
  baseOpacity: number;
  currentOpacity: number;
  bodyId: string;      // body this orbit belongs to (fades when camera is at the body)
  fadeRadius: number;  // visual radius of that body — sets the proximity-fade zone
  parentId?: string;   // moons: recentered on the parent each frame
  parentVisualRadius?: number;
  orbitRadiusUnits?: number;
}

/**
 * OrbitLines draws each body's orbit as a thin colored line — the Eyes on the
 * Solar System mapping: one signature hue per body shared by orbit + label.
 *
 * Planets/Pluto: real paths sampled from astronomy-engine (computed once —
 * orbits don't change at human timescales). Moons: guide circles recentered on
 * their parent each frame, shown only when the camera is in the parent's
 * neighborhood. Asteroids: the same parametric path Ephemeris flies them on.
 */
export class OrbitLines {
  private group = new THREE.Group();
  private lines: OrbitLine[] = [];
  private visible = true;
  private _v = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group.name = 'orbit-lines';
    scene.add(this.group);
  }

  private makeLine(
    positions: Float32Array,
    color: string,
    baseOpacity: number,
    entry: Omit<OrbitLine, 'line' | 'material' | 'baseOpacity' | 'currentOpacity'>
  ): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // Trailing-arc shader: only the half-orbit BEHIND the body is drawn,
    // full strength at the body fading smoothly to nothing half an orbit
    // back (Eyes-style motion trail; also shows travel direction for free).
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: baseOpacity },
        uBodyAngle: { value: 0 },
      },
      vertexShader: `
        uniform float uBodyAngle;
        varying float vTrail;
        void main() {
          // All orbits are parametrized counterclockwise in the xz-plane,
          // so angular distance BEHIND the body is (bodyAngle - vertexAngle)
          float a = atan(position.z, position.x);
          float behind = mod(uBodyAngle - a, 6.2831853);
          vTrail = clamp(1.0 - behind / 3.14159265, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vTrail;
        void main() {
          float alpha = vTrail * vTrail * uOpacity; // quadratic = softer tail
          if (alpha < 0.001) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.LineLoop(geometry, material);
    line.frustumCulled = false; // huge loops flicker with sphere culling near the edge
    this.group.add(line);
    this.lines.push({ line, material, baseOpacity, currentOpacity: baseOpacity, ...entry });
  }

  /**
   * Sample real planetary orbits from astronomy-engine. Chunked with yields so
   * the loader / first frames stay responsive; call fire-and-forget after init.
   */
  async initPlanetOrbits(): Promise<void> {
    const now = Date.now();
    for (const [bodyId, astroBody] of Object.entries(ASTRO_BODY)) {
      const periodDays = PLANET_PERIOD_DAYS[bodyId];
      const config = BODIES.find(b => b.id === bodyId);
      if (!periodDays || !config) continue;

      const positions = new Float32Array(PLANET_SEGMENTS * 3);
      for (let i = 0; i < PLANET_SEGMENTS; i++) {
        const date = new Date(now + (i / PLANET_SEGMENTS) * periodDays * MS_PER_DAY);
        const vec = Astronomy.HelioVector(astroBody, date);
        positions[i * 3] = (vec.x * AU_TO_KM) / KM_PER_UNIT;
        positions[i * 3 + 1] = (vec.z * AU_TO_KM) / KM_PER_UNIT;
        positions[i * 3 + 2] = (vec.y * AU_TO_KM) / KM_PER_UNIT;
      }

      const visualRadius = (config.radiusKm / KM_PER_UNIT) * BODY_VISUAL_SCALE;
      this.makeLine(positions, config.identityColor ?? '#9e9e9e', PLANET_OPACITY, {
        bodyId,
        fadeRadius: visualRadius,
      });

      // Yield between planets so orbit sampling never blocks a frame
      await new Promise(r => setTimeout(r, 0));
    }
    this.group.visible = this.visible;
  }

  /** Moon guide circles + asteroid orbits — cheap, synchronous. */
  initMoonAndAsteroidOrbits(): void {
    for (const [moonId, orbit] of Object.entries(MOON_ORBITS)) {
      const config = BODIES.find(b => b.id === moonId);
      const parent = config?.parentId ? BODIES.find(b => b.id === config.parentId) : undefined;
      if (!config || !parent) continue;

      const radiusUnits = (orbit.semiMajorAxisKm / KM_PER_UNIT) * BODY_VISUAL_SCALE;
      const parentVisualRadius = (parent.radiusKm / KM_PER_UNIT) * BODY_VISUAL_SCALE;
      this.makeLine(
        sampleCircleOrbit(radiusUnits, CIRCLE_SEGMENTS),
        config.identityColor ?? '#9e9e9e',
        MOON_OPACITY,
        {
          bodyId: moonId,
          fadeRadius: (config.radiusKm / KM_PER_UNIT) * BODY_VISUAL_SCALE,
          parentId: parent.id,
          parentVisualRadius,
          orbitRadiusUnits: radiusUnits,
        }
      );
    }

    for (const [id, orbit] of Object.entries(ASTEROID_ORBITS)) {
      const config = BODIES.find(b => b.id === id);
      this.makeLine(
        sampleAsteroidOrbit(orbit.semiMajorAxisAU, orbit.inclination, PLANET_SEGMENTS),
        config?.identityColor ?? '#9e9e9e',
        ASTEROID_OPACITY,
        {
          bodyId: id,
          fadeRadius: config ? (config.radiusKm / KM_PER_UNIT) * BODY_VISUAL_SCALE : 0.05,
        }
      );
    }
    this.group.visible = this.visible;
  }

  /**
   * Per-frame: recenter moon orbits on their parent, fade lines near their own
   * body (a line through your face is noise once you've arrived), and show
   * moon systems only when the camera is in the neighborhood.
   */
  update(
    cameraPos: THREE.Vector3,
    positions: Map<string, [number, number, number]>
  ): void {
    if (!this.visible) return;

    for (const ol of this.lines) {
      // Moon orbits track their parent planet
      if (ol.parentId) {
        const p = positions.get(ol.parentId);
        if (p) ol.line.position.set(p[0], p[1], p[2]);

        // Neighborhood gate: hide moon orbits unless camera is near the system
        const distToParent = this._v.set(p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0).distanceTo(cameraPos);
        const neighborhood = Math.max(
          (ol.parentVisualRadius ?? 0.1) * 40,
          (ol.orbitRadiusUnits ?? 0) * 2.5
        );
        if (distToParent > neighborhood) {
          ol.line.visible = false;
          continue;
        }
        ol.line.visible = true;
      }

      // Proximity fade toward the orbit's own body
      const bp = positions.get(ol.bodyId);
      let fade = 1;
      if (bp) {
        const d = this._v.set(bp[0], bp[1], bp[2]).distanceTo(cameraPos);
        const r = Math.max(ol.fadeRadius, 0.01);
        fade = Math.min(Math.max((d - 8 * r) / (17 * r), 0), 1);

        // Anchor the trailing arc at the body's current orbital angle
        // (moons: angle around their parent; planets/asteroids: around the sun)
        let cx = 0, cz = 0;
        if (ol.parentId) {
          const pp = positions.get(ol.parentId);
          if (pp) { cx = pp[0]; cz = pp[2]; }
        }
        ol.material.uniforms.uBodyAngle.value = Math.atan2(bp[2] - cz, bp[0] - cx);
      }
      const target = ol.baseOpacity * fade;
      if (Math.abs(ol.currentOpacity - target) > 0.002) {
        // ease toward target so fades never pop
        ol.currentOpacity += (target - ol.currentOpacity) * 0.15;
        ol.material.uniforms.uOpacity.value = ol.currentOpacity;
      }
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible;
  }

  dispose(): void {
    for (const ol of this.lines) {
      ol.line.geometry.dispose();
      ol.material.dispose();
    }
    this.lines = [];
  }
}
