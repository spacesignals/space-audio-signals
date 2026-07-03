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

      // Adaptive tessellation: fewer segments for small bodies.
      // High enough that silhouettes stay round when the camera is close.
      const segments = config.type === 'star' ? 128
        : config.type === 'planet' ? 96
        : 64; // moons, dwarf planets, asteroids
      const geometry = new THREE.SphereGeometry(radiusUnits, segments, segments / 2);

      // Only generate procedural texture if no real texture file exists
      const hasRealTexture = !!config.textureFile;
      const proceduralTex = hasRealTexture ? null : getProceduralTexture(config.id);

      // Material
      let material: THREE.Material;

      if (config.emissive) {
        // Sun: emissive, unlit
        material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(config.color || '#FDB813'),
          ...(proceduralTex ? { map: proceduralTex } : {}),
        });
        if (config.textureFile) {
          this.textureLoader.load(`${import.meta.env.BASE_URL}textures/${config.textureFile}`, (texture) => {
            (material as THREE.MeshBasicMaterial).map = texture;
            (material as THREE.MeshBasicMaterial).color.set(0xffffff);
            (material as THREE.MeshBasicMaterial).needsUpdate = true;
          });
        }
      } else if (config.id === 'earth') {
        // Earth: custom day/night shader (always loads real textures)
        material = this.createEarthMaterial();
      } else {
        // Planets/moons: emissive tint so they're visible far from the Sun
        const color = new THREE.Color(config.color || '#888888');
        material = new THREE.MeshStandardMaterial({
          color: proceduralTex ? 0xffffff : color,
          ...(proceduralTex ? { map: proceduralTex } : {}),
          roughness: 0.9,
          metalness: 0.0,
          emissive: color,
          emissiveIntensity: proceduralTex ? 0.08 : 0.15,
        });

        // Load file texture (primary path for most bodies now)
        if (config.textureFile) {
          this.textureLoader.load(
            `${import.meta.env.BASE_URL}textures/${config.textureFile}`,
            (texture) => {
              const mat = material as THREE.MeshStandardMaterial;
              mat.map = texture;
              mat.color.set(0xffffff);
              mat.emissiveIntensity = 0.02;
              mat.needsUpdate = true;
            },
            undefined,
            // On failure: fall back to procedural generation
            () => {
              const fallback = getProceduralTexture(config.id);
              if (fallback) {
                const mat = material as THREE.MeshStandardMaterial;
                mat.map = fallback;
                mat.color.set(0xffffff);
                mat.emissiveIntensity = 0.08;
                mat.needsUpdate = true;
              }
            }
          );
        }
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = config.id;
      this.scene.add(mesh);

      const bodyMesh: BodyMesh = { config, mesh };

      // Rings (Saturn, Uranus, Neptune)
      if (config.hasRings && config.ringInnerRadiusKm && config.ringOuterRadiusKm) {
        const innerR = (config.ringInnerRadiusKm / KM_PER_UNIT) * RING_VISUAL_SCALE;
        const outerR = (config.ringOuterRadiusKm / KM_PER_UNIT) * RING_VISUAL_SCALE;
        const ringGeom = new THREE.RingGeometry(innerR, outerR, 128);
        // Remap UVs: texture maps radially (inner→outer), not around the ring
        const uvs = ringGeom.attributes.uv;
        const pos = ringGeom.attributes.position;
        for (let i = 0; i < uvs.count; i++) {
          const x = pos.getX(i);
          const z = pos.getY(i); // RingGeometry is in XY plane
          const dist = Math.sqrt(x * x + z * z);
          const t = (dist - innerR) / (outerR - innerR);
          uvs.setXY(i, t, 0.5);
        }
        // Neptune: very faint dusty rings. Others: golden default.
        const isNeptune = config.id === 'neptune';
        const ringMat = new THREE.MeshBasicMaterial({
          color: isNeptune ? 0x8888aa : 0xc8b070,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: isNeptune ? 0.12 : 0.6,
        });
        // Load ring texture if Saturn
        if (config.id === 'saturn') {
          this.textureLoader.load(`${import.meta.env.BASE_URL}textures/saturn_ring.png`, (texture) => {
            ringMat.map = texture;
            ringMat.color.set(0xffffff);
            ringMat.needsUpdate = true;
          });
        }
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
      depthTest: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2, 0.5, 1);
    return sprite;
  }

  private createEarthMaterial(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: new THREE.Texture() },
        nightMap: { value: new THREE.Texture() },
        // Sun sits at the origin; shader computes per-fragment direction from this
        sunDirection: { value: new THREE.Vector3(0, 0, 0) },
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
          float blend = smoothstep(-0.05, 0.1, NdotL);
          vec3 day = texture2D(dayMap, vUv).rgb;
          vec3 night = texture2D(nightMap, vUv).rgb;
          // Day: full diffuse lighting. Night: only city lights, pure dark otherwise
          vec3 litDay = day * max(NdotL, 0.0);
          // Threshold night texture: only show bright pixels (city lights)
          // Everything else (blue oceans, dark land) goes to pure black
          float nightLum = dot(night, vec3(0.299, 0.587, 0.114));
          float cityMask = smoothstep(0.08, 0.2, nightLum);
          vec3 litNight = night * cityMask * 1.5;
          vec3 color = mix(litNight, litDay, blend);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    const base = import.meta.env.BASE_URL;
    // Load day texture
    this.textureLoader.load(`${base}textures/earth.jpg`, (texture) => {
      mat.uniforms.dayMap.value = texture;
    });
    // Load night texture
    this.textureLoader.load(`${base}textures/earth_night.jpg`, (texture) => {
      mat.uniforms.nightMap.value = texture;
    });

    return mat;
  }

  private createStarfield(): void {
    // Milky Way skybox — try real texture first, procedural only on failure
    const skyGeom = new THREE.SphereGeometry(STARFIELD_RADIUS, 64, 32);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x000005,
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeom, skyMat);
    this.scene.add(sky);

    this.textureLoader.load(
      `${import.meta.env.BASE_URL}textures/milkyway.jpg`,
      (texture) => {
        skyMat.map = texture;
        skyMat.color.set(0xffffff);
        skyMat.needsUpdate = true;
      },
      undefined,
      () => {
        // Real texture failed — generate procedural fallback
        const proceduralSky = generateSkyboxTexture();
        skyMat.map = proceduralSky;
        skyMat.color.set(0xffffff);
        skyMat.needsUpdate = true;
      }
    );
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
