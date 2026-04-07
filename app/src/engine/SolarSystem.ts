import * as THREE from 'three';
import type { CelestialBodyConfig } from '../types';
import {
  KM_PER_UNIT,
  BODY_VISUAL_SCALE,
  SUN_VISUAL_SCALE,
  RING_VISUAL_SCALE,
  STARFIELD_RADIUS,
} from '../data/constants';
import { getProceduralTexture, generateSkyboxTexture } from './ProceduralTextures';

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
  private earthMaterial: THREE.ShaderMaterial | null = null;
  private _labelWorldPos = new THREE.Vector3(); // reusable for updateLabels

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Sun as the sole light source
    this.sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
    this.sunLight.position.set(0, 0, 0);
    this.scene.add(this.sunLight);

    // Ambient so shadow-side of planets aren't pure black
    const ambient = new THREE.AmbientLight(0x222233, 0.4);
    this.scene.add(ambient);

    this.createStarfield();
  }

  /**
   * Create mesh for each celestial body.
   */
  async initBodies(bodies: CelestialBodyConfig[], onProgress?: (pct: number) => void): Promise<void> {
    for (let i = 0; i < bodies.length; i++) {
      const config = bodies[i];
      // Yield to browser so progress bar can update
      if (onProgress) {
        onProgress(((i + 1) / (bodies.length + 1)) * 100); // +1 for skybox
        await new Promise(r => setTimeout(r, 0));
      }
      const scale = config.type === 'star' ? SUN_VISUAL_SCALE : BODY_VISUAL_SCALE;
      const radiusUnits = (config.radiusKm / KM_PER_UNIT) * scale;

      // Sphere geometry
      const geometry = new THREE.SphereGeometry(radiusUnits, 64, 32);

      // Material
      let material: THREE.Material;
      const proceduralTex = getProceduralTexture(config.id);

      if (config.emissive) {
        // Sun: emissive, unlit
        material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(config.color || '#FDB813'),
          map: proceduralTex || undefined,
        });
        if (config.textureFile) {
          this.textureLoader.load(`/textures/${config.textureFile}`, (texture) => {
            (material as THREE.MeshBasicMaterial).map = texture;
            (material as THREE.MeshBasicMaterial).color.set(0xffffff);
            (material as THREE.MeshBasicMaterial).needsUpdate = true;
          });
        }
      } else if (config.id === 'earth') {
        // Earth: custom day/night shader blending based on sun direction
        material = this.createEarthMaterial(proceduralTex);
      } else {
        // Planets/moons: emissive tint so they're visible far from the Sun
        const color = new THREE.Color(config.color || '#888888');
        material = new THREE.MeshStandardMaterial({
          color: proceduralTex ? 0xffffff : color,
          map: proceduralTex || undefined,
          roughness: 0.9,
          metalness: 0.0,
          emissive: color,
          emissiveIntensity: proceduralTex ? 0.08 : 0.15,
        });

        // Try loading file texture — overrides procedural if available
        if (config.textureFile) {
          this.textureLoader.load(
            `/textures/${config.textureFile}`,
            (texture) => {
              const mat = material as THREE.MeshStandardMaterial;
              mat.map = texture;
              mat.color.set(0xffffff);
              mat.emissiveIntensity = 0.02;
              mat.needsUpdate = true;
            },
            undefined,
            () => {}
          );
        }
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = config.id;
      this.scene.add(mesh);

      const bodyMesh: BodyMesh = { config, mesh };

      // Atmosphere glow disabled — bloom handles the glow effect
      bodyMesh.atmosphere = undefined;

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
    // Update Earth day/night shader with sun position (always at origin)
    if (this.earthMaterial) {
      this.earthMaterial.uniforms.sunDirection.value.set(0, 0, 0);
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
      depthTest: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2, 0.5, 1);
    return sprite;
  }

  private createEarthMaterial(proceduralTex: THREE.CanvasTexture | null): THREE.ShaderMaterial {
    const dayTex = proceduralTex || new THREE.Texture();
    const nightTex = new THREE.Texture();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: dayTex },
        nightMap: { value: nightTex },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vUv = uv;
          vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vPosW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D dayMap;
        uniform sampler2D nightMap;
        uniform vec3 sunDirection;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vec3 sunDir = normalize(sunDirection - vPosW);
          float NdotL = dot(vNormalW, sunDir);
          // Smooth transition across terminator (-0.1 to 0.1)
          float blend = smoothstep(-0.1, 0.1, NdotL);
          vec3 day = texture2D(dayMap, vUv).rgb;
          vec3 night = texture2D(nightMap, vUv).rgb;
          // Day side gets diffuse lighting, night side shows city lights
          vec3 litDay = day * (0.15 + 0.85 * max(NdotL, 0.0));
          vec3 litNight = night * 1.5; // boost city lights
          vec3 color = mix(litNight, litDay, blend);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    // Load day texture
    this.textureLoader.load('/textures/earth.jpg', (texture) => {
      mat.uniforms.dayMap.value = texture;
    });
    // Load night texture
    this.textureLoader.load('/textures/earth_night.jpg', (texture) => {
      mat.uniforms.nightMap.value = texture;
    });

    this.earthMaterial = mat;
    return mat;
  }

  private createStarfield(): void {
    // Milky Way skybox — use real texture, fall back to procedural
    const skyGeom = new THREE.SphereGeometry(STARFIELD_RADIUS, 64, 32);
    const proceduralSky = generateSkyboxTexture();
    const skyMat = new THREE.MeshBasicMaterial({
      map: proceduralSky,
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeom, skyMat);
    this.scene.add(sky);

    // Try loading real milky way texture
    this.textureLoader.load('/textures/milkyway.jpg', (texture) => {
      skyMat.map = texture;
      skyMat.needsUpdate = true;
    });
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
