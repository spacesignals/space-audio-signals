import * as THREE from 'three';
import { KM_PER_UNIT } from '../data/constants';

const AU_TO_KM = 149_597_870.7;
const AU_UNITS = AU_TO_KM / KM_PER_UNIT; // one AU in Three.js units
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MS_PER_DAY = 86_400_000;

/** Deterministic PRNG (mulberry32) — same belt every visit, no flicker on reload. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kepler's third law: orbital period in days for a semi-major axis in AU. */
export function keplerPeriodDays(aAU: number): number {
  return 365.25 * Math.pow(aAU, 1.5);
}

interface BeltSpec {
  name: string;
  count: number;
  aMinAU: number;
  aMaxAU: number;
  incMaxRad: number; // max orbital inclination (vertical scatter)
  color: string;
  sizePx: number;
  opacity: number;
  seed: number;
}

/**
 * BeltField renders the asteroid belt and Kuiper belt as single THREE.Points
 * clouds — the "swarm as texture" effect from NASA Eyes' 43k-NEO point cloud.
 * Each point is on its own circular Keplerian orbit; motion happens entirely
 * in the vertex shader from a sim-time uniform, so the whole belt orbits (and
 * responds to time scrubbing) at zero per-frame CPU cost.
 */
export class BeltField {
  private group = new THREE.Group();
  private materials: THREE.ShaderMaterial[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private visible = true;

  constructor(scene: THREE.Scene, reducedDetail = false) {
    this.group.name = 'belt-fields';
    const q = reducedDetail ? 0.4 : 1; // mobile: fewer points, same look

    // Main belt: Mars–Jupiter, bluish-gray like Eyes' asteroid points
    this.makeBelt({
      name: 'main-belt',
      count: Math.round(12_000 * q),
      aMinAU: 2.1,
      aMaxAU: 3.3,
      incMaxRad: 0.28,
      color: '#8fa3b8',
      sizePx: 1.6,
      opacity: 0.55,
      seed: 20260719,
    });

    // Kuiper belt: beyond Neptune — the solar system doesn't end at the planets
    this.makeBelt({
      name: 'kuiper-belt',
      count: Math.round(6_000 * q),
      aMinAU: 30,
      aMaxAU: 50,
      incMaxRad: 0.35,
      color: '#b8a48f',
      sizePx: 1.8,
      opacity: 0.35,
      seed: 19301894,
    });

    scene.add(this.group);
  }

  private makeBelt(spec: BeltSpec): void {
    const rand = mulberry32(spec.seed);
    const n = spec.count;

    const radius = new Float32Array(n);
    const phase = new Float32Array(n);
    const speed = new Float32Array(n); // radians per sim-day
    const yAmp = new Float32Array(n);
    const yPhase = new Float32Array(n);
    const bright = new Float32Array(n);
    // Base position attribute required by WebGL — actual position comes from
    // the orbital attributes in the vertex shader.
    const positions = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      // Slight edge falloff: denser mid-belt
      const t = (rand() + rand()) / 2;
      const aAU = spec.aMinAU + t * (spec.aMaxAU - spec.aMinAU);
      radius[i] = aAU * AU_UNITS * (0.98 + rand() * 0.04); // small eccentricity jitter
      phase[i] = rand() * Math.PI * 2;
      speed[i] = (2 * Math.PI) / keplerPeriodDays(aAU);
      const inc = (rand() - 0.5) * 2 * spec.incMaxRad;
      yAmp[i] = Math.sin(inc) * aAU * AU_UNITS;
      yPhase[i] = rand() * Math.PI * 2;
      bright[i] = 0.35 + 0.65 * Math.pow(rand(), 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geometry.setAttribute('aYAmp', new THREE.BufferAttribute(yAmp, 1));
    geometry.setAttribute('aYPhase', new THREE.BufferAttribute(yPhase, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    // The cloud spans its whole annulus; skip per-point culling math
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      spec.aMaxAU * AU_UNITS * 1.2
    );

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSimDays: { value: 0 },
        uColor: { value: new THREE.Color(spec.color) },
        uSize: { value: spec.sizePx },
        uOpacity: { value: spec.opacity },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float aRadius;
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aYAmp;
        attribute float aYPhase;
        attribute float aBright;
        uniform float uSimDays;
        uniform float uSize;
        uniform float uPixelRatio;
        varying float vBright;
        void main() {
          float angle = aPhase + aSpeed * uSimDays;
          vec3 orbitPos = vec3(
            cos(angle) * aRadius,
            aYAmp * sin(angle + aYPhase),
            sin(angle) * aRadius
          );
          vBright = aBright;
          vec4 mvPos = modelViewMatrix * vec4(orbitPos, 1.0);
          // Distance-attenuated size: near points grow, far points shrink —
          // without this the cloud has zero parallax and reads as a flat
          // backdrop that never responds to camera movement.
          float dist = max(length(mvPos.xyz), 0.001);
          gl_PointSize = uSize * uPixelRatio * clamp(80.0 / dist, 0.4, 6.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vBright;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float alpha = smoothstep(0.5, 0.1, d) * uOpacity * vBright;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    points.name = spec.name;
    this.group.add(points);
    this.materials.push(material);
    this.geometries.push(geometry);
  }

  /** Per-frame: feed sim time so the belts orbit (and time-scrub) for free. */
  update(simMs: number): void {
    if (!this.visible) return;
    const simDays = (simMs - J2000_MS) / MS_PER_DAY;
    for (const m of this.materials) {
      m.uniforms.uSimDays.value = simDays;
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = [];
    this.materials = [];
  }
}
