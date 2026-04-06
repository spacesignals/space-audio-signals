import * as THREE from 'three';
import type { CelestialBodyConfig } from '../types';
import {
  KM_PER_UNIT,
  BODY_VISUAL_SCALE,
  SUN_VISUAL_SCALE,
  RING_VISUAL_SCALE,
  STARFIELD_COUNT,
  STARFIELD_RADIUS,
} from '../data/constants';

interface BodyMesh {
  config: CelestialBodyConfig;
  mesh: THREE.Mesh;
  atmosphere?: THREE.Mesh;
  rings?: THREE.Mesh;
  label?: THREE.Sprite;
}

/**
 * SolarSystem manages the 3D scene: bodies, starfield, lighting, post-processing.
 */
export class SolarSystem {
  private scene: THREE.Scene;
  private bodyMeshes: Map<string, BodyMesh> = new Map();
  private textureLoader = new THREE.TextureLoader();
  private sunLight: THREE.PointLight;
  private _labelWorldPos = new THREE.Vector3(); // reusable for updateLabels

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Sun as the sole light source
    this.sunLight = new THREE.PointLight(0xffffff, 2, 0, 0.5);
    this.sunLight.position.set(0, 0, 0);
    this.scene.add(this.sunLight);

    // Dim ambient so shadow-side of planets aren't pure black
    const ambient = new THREE.AmbientLight(0x111122, 0.15);
    this.scene.add(ambient);

    this.createStarfield();
  }

  /**
   * Create mesh for each celestial body.
   */
  initBodies(bodies: CelestialBodyConfig[]): void {
    for (const config of bodies) {
      const scale = config.type === 'star' ? SUN_VISUAL_SCALE : BODY_VISUAL_SCALE;
      const radiusUnits = (config.radiusKm / KM_PER_UNIT) * scale;

      // Sphere geometry
      const geometry = new THREE.SphereGeometry(radiusUnits, 64, 32);

      // Material
      let material: THREE.Material;
      if (config.emissive) {
        // Sun: emissive, unlit
        material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(config.color || '#FDB813'),
        });
      } else {
        // Planets: emissive tint so they're always visible even far from the Sun.
        // Without this, distant planets are nearly invisible against the starfield.
        const color = new THREE.Color(config.color || '#888888');
        const matOptions: THREE.MeshStandardMaterialParameters = {
          color,
          roughness: 0.8,
          metalness: 0.1,
          emissive: color,
          emissiveIntensity: 0.3, // enough to see, not enough to look self-lit
        };
        material = new THREE.MeshStandardMaterial(matOptions);

        // Load texture async — swaps in when ready
        if (config.textureFile) {
          this.textureLoader.load(
            `/textures/${config.textureFile}`,
            (texture) => {
              (material as THREE.MeshStandardMaterial).map = texture;
              (material as THREE.MeshStandardMaterial).needsUpdate = true;
            },
            undefined,
            () => {
              // Texture load failed — keep fallback color
              console.warn(`Texture not found: ${config.textureFile}`);
            }
          );
        }
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = config.id;
      this.scene.add(mesh);

      const bodyMesh: BodyMesh = { config, mesh };

      // Atmosphere glow (simple additive sphere slightly larger)
      if (config.atmosphereColor) {
        const atmoGeom = new THREE.SphereGeometry(radiusUnits * 1.05, 32, 16);
        const atmoMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(config.atmosphereColor),
          transparent: true,
          opacity: 0.15,
          side: THREE.BackSide,
        });
        const atmo = new THREE.Mesh(atmoGeom, atmoMat);
        mesh.add(atmo);
        bodyMesh.atmosphere = atmo;
      }

      // Rings (Saturn, Uranus)
      if (config.hasRings && config.ringInnerRadiusKm && config.ringOuterRadiusKm) {
        const innerR = (config.ringInnerRadiusKm / KM_PER_UNIT) * RING_VISUAL_SCALE;
        const outerR = (config.ringOuterRadiusKm / KM_PER_UNIT) * RING_VISUAL_SCALE;
        const ringGeom = new THREE.RingGeometry(innerR, outerR, 64);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xc8b070,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6,
        });
        const ringMesh = new THREE.Mesh(ringGeom, ringMat);
        ringMesh.rotation.x = Math.PI / 2 * 0.9; // slight tilt
        mesh.add(ringMesh);
        bodyMesh.rings = ringMesh;
      }

      // Text label (Three.js sprite) — positioned above body, scaled per-frame for constant screen size
      const label = this.createLabel(config.name);
      label.position.set(0, radiusUnits * 1.3, 0);
      mesh.add(label);
      bodyMesh.label = label;

      this.bodyMeshes.set(config.id, bodyMesh);
    }
  }

  /**
   * Update body positions from ephemeris data.
   * @param positions Map of bodyId -> [x, y, z] in Three.js units
   */
  updatePositions(positions: Map<string, [number, number, number]>): void {
    for (const [id, pos] of positions) {
      const body = this.bodyMeshes.get(id);
      if (body) {
        body.mesh.position.set(pos[0], pos[1], pos[2]);
      }
    }
  }

  /**
   * Rotate bodies for visual interest (not physically accurate, just looks nice).
   */
  updateRotations(deltaTime: number): void {
    for (const [, body] of this.bodyMeshes) {
      // Slow rotation proportional to 1/radius (smaller = faster spin)
      const speed = 0.01 / Math.max(body.config.radiusKm / 10000, 1);
      body.mesh.rotation.y += speed * deltaTime;
    }
  }

  /**
   * Toggle label visibility.
   */
  setLabelsVisible(visible: boolean): void {
    for (const [, body] of this.bodyMeshes) {
      if (body.label) body.label.visible = visible;
    }
  }

  /**
   * Update label scales so they appear the same size on screen regardless of distance.
   * Call each frame with the camera position.
   */
  updateLabels(camera: THREE.PerspectiveCamera): void {
    const targetScreenFraction = 0.08; // labels occupy ~8% of screen height
    const fovRad = (camera.fov * Math.PI) / 180;

    for (const [, body] of this.bodyMeshes) {
      if (!body.label) continue;

      // World position of the label (reuse pre-allocated vector)
      body.label.getWorldPosition(this._labelWorldPos);
      const dist = camera.position.distanceTo(this._labelWorldPos);

      // Size in world units needed to subtend targetScreenFraction of viewport
      const worldSize = 2 * dist * Math.tan(fovRad / 2) * targetScreenFraction;
      const scale = Math.max(worldSize, 0.01);
      body.label.scale.set(scale * 4, scale, 1); // 4:1 aspect ratio for text

      // Adjust label vertical offset based on body visual radius so it's always above the body
      const bodyScale = body.config.type === 'star' ? SUN_VISUAL_SCALE : BODY_VISUAL_SCALE;
      const radiusUnits = (body.config.radiusKm / KM_PER_UNIT) * bodyScale;
      body.label.position.set(0, radiusUnits + scale * 0.6, 0);
    }
  }

  getBodyPosition(id: string): THREE.Vector3 | null {
    const body = this.bodyMeshes.get(id);
    return body ? body.mesh.position.clone() : null;
  }

  /**
   * Get the visual radius of a body in Three.js units (after scale exaggeration).
   */
  getBodyVisualRadius(id: string): number | null {
    const body = this.bodyMeshes.get(id);
    if (!body) return null;
    const scale = body.config.type === 'star' ? SUN_VISUAL_SCALE : BODY_VISUAL_SCALE;
    return (body.config.radiusKm / KM_PER_UNIT) * scale;
  }

  private createLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '100 24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2, 0.5, 1);
    return sprite;
  }

  private createStarfield(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(STARFIELD_COUNT * 3);
    const colors = new Float32Array(STARFIELD_COUNT * 3);

    for (let i = 0; i < STARFIELD_COUNT; i++) {
      // Random positions on a sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = STARFIELD_RADIUS * (0.8 + Math.random() * 0.2);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Slightly varied star colors (white, blue-white, yellow-white)
      const temp = Math.random();
      if (temp < 0.6) {
        colors[i * 3] = 0.9 + Math.random() * 0.1;
        colors[i * 3 + 1] = 0.9 + Math.random() * 0.1;
        colors[i * 3 + 2] = 1.0;
      } else if (temp < 0.85) {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.95;
        colors[i * 3 + 2] = 0.8;
      } else {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.8;
        colors[i * 3 + 2] = 0.6;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 1.0,
      vertexColors: true,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.4,
    });

    const stars = new THREE.Points(geometry, material);
    this.scene.add(stars);
  }

  getBodyCount(): number {
    return this.bodyMeshes.size;
  }

  getLoadedTextureCount(): number {
    let count = 0;
    for (const [, body] of this.bodyMeshes) {
      const mat = body.mesh.material;
      if (mat instanceof THREE.MeshStandardMaterial && mat.map) count++;
    }
    return count;
  }

  dispose(): void {
    for (const [, body] of this.bodyMeshes) {
      body.mesh.geometry.dispose();
      if (body.mesh.material instanceof THREE.Material) {
        body.mesh.material.dispose();
      }
    }
    this.bodyMeshes.clear();
  }
}
