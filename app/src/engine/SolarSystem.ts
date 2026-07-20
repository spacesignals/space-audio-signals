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
}

/**
 * SolarSystem manages the 3D scene: bodies, starfield, lighting, post-processing.
 */
export class SolarSystem {
  private scene: THREE.Scene;
  private bodyMeshes: Map<string, BodyMesh> = new Map();
  private textureLoader = new THREE.TextureLoader();
  private sunLight: THREE.PointLight;
  private maxAnisotropy: number;
  private starTime = 0;
  private starMaterial: THREE.ShaderMaterial | null = null;
  private ambient: THREE.AmbientLight;
  private ambientTarget: number;
  private skyMesh: THREE.Mesh | null = null;
  private pointStars: THREE.Points | null = null;

  /** Natural lighting: sun-driven, dim ambient. Flood: night sides inspectable. */
  private static readonly AMBIENT_NATURAL = 0.4;
  private static readonly AMBIENT_FLOOD = 2.2;

  private uploadTexture?: (texture: THREE.Texture) => void;

  constructor(
    scene: THREE.Scene,
    maxAnisotropy = 1,
    uploadTexture?: (texture: THREE.Texture) => void
  ) {
    this.scene = scene;
    this.maxAnisotropy = maxAnisotropy;
    this.uploadTexture = uploadTexture;

    // Sun as the sole light source
    this.sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
    this.sunLight.position.set(0, 0, 0);
    this.scene.add(this.sunLight);

    // Ambient so shadow-side of planets aren't pure black
    this.ambient = new THREE.AmbientLight(0x222233, SolarSystem.AMBIENT_NATURAL);
    this.ambientTarget = SolarSystem.AMBIENT_NATURAL;
    this.scene.add(this.ambient);

    this.createStarfield();
  }

  /**
   * Mark a color texture as sRGB and enable anisotropic filtering.
   * Without the sRGB tag the renderer treats texel values as linear and the
   * output encode washes them out (low contrast, desaturated).
   */
  private prepColorTexture(texture: THREE.Texture): THREE.Texture {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.maxAnisotropy;
    // Upload to the GPU now (at load time) instead of stalling the frame
    // where the texture first becomes visible.
    this.uploadTexture?.(texture);
    return texture;
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
        // Sun: emissive, unlit. Color multiplier pushes luminance into HDR
        // (>1.0) so the bloom pass threshold actually catches the Sun.
        material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(config.color || '#FDB813').multiplyScalar(2.5),
          ...(proceduralTex ? { map: proceduralTex } : {}),
          toneMapped: true,
        });
        if (config.textureFile) {
          this.textureLoader.load(`${import.meta.env.BASE_URL}textures/${config.textureFile}`, (texture) => {
            this.prepColorTexture(texture);
            (material as THREE.MeshBasicMaterial).map = texture;
            (material as THREE.MeshBasicMaterial).color.setScalar(2.5);
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
              this.prepColorTexture(texture);
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

      // Sun corona: soft additive halo sprites around the disc
      if (config.emissive) {
        mesh.add(this.createCorona(radiusUnits));
      }

      // Atmosphere rim: fresnel shell for bodies configured with an atmosphere
      if (config.atmosphereColor && !config.emissive) {
        mesh.add(this.createAtmosphere(radiusUnits, config.atmosphereColor));
      }

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
        // Saturn: bright golden (real texture loads below). Uranus: narrow,
        // dark charcoal-gray. Neptune: very faint dusty rings.
        const ringLook: Record<string, { color: number; opacity: number }> = {
          saturn: { color: 0xc8b070, opacity: 0.6 },
          uranus: { color: 0x76808c, opacity: 0.18 },
          neptune: { color: 0x8888aa, opacity: 0.12 },
        };
        const look = ringLook[config.id] ?? { color: 0x9a9a9a, opacity: 0.3 };
        const ringMat = new THREE.MeshBasicMaterial({
          color: look.color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: look.opacity,
          depthWrite: false, // transparent rings must not punch holes in what's behind them
        });
        // Load ring texture if Saturn
        if (config.id === 'saturn') {
          this.textureLoader.load(`${import.meta.env.BASE_URL}textures/saturn_ring.png`, (texture) => {
            this.prepColorTexture(texture);
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
    // Advance star twinkle
    if (this.starMaterial) {
      this.starTime += deltaTime;
      this.starMaterial.uniforms.time.value = this.starTime;
    }
    // Ease ambient toward its target so lighting-mode switches never pop
    const diff = this.ambientTarget - this.ambient.intensity;
    if (Math.abs(diff) > 0.001) {
      this.ambient.intensity += diff * Math.min(1, deltaTime * 4);
    }
  }

  /** Flood lighting: raise ambient so night sides are inspectable. Eased, ~0.5s. */
  setFloodLighting(flood: boolean): void {
    this.ambientTarget = flood ? SolarSystem.AMBIENT_FLOOD : SolarSystem.AMBIENT_NATURAL;
  }

  /** Toggle the Milky Way skybox + point stars layer. */
  setStarfieldVisible(visible: boolean): void {
    if (this.skyMesh) this.skyMesh.visible = visible;
    if (this.pointStars) this.pointStars.visible = visible;
  }

  /**
   * Raycast pick: returns the bodyId under the ray, or null. Hits on child
   * objects (atmosphere shells, rings, corona sprites) resolve to their body.
   */
  pickBody(raycaster: THREE.Raycaster): string | null {
    const meshes: THREE.Object3D[] = [];
    for (const [, body] of this.bodyMeshes) meshes.push(body.mesh);
    const hits = raycaster.intersectObjects(meshes, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (this.bodyMeshes.has(obj.name)) return obj.name;
        obj = obj.parent;
      }
    }
    return null;
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

  /**
   * Soft radial glow billboard around the Sun. Two layers: a tight warm core
   * halo and a wide faint outer corona. Additive so it reads as light.
   */
  private createCorona(sunRadiusUnits: number): THREE.Group {
    const group = new THREE.Group();

    const makeHaloTexture = (innerStop: number, rgb: string): THREE.CanvasTexture => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, `rgba(${rgb}, 1)`);
      grad.addColorStop(innerStop, `rgba(${rgb}, 0.35)`);
      grad.addColorStop((1 + innerStop) / 2, `rgba(${rgb}, 0.08)`); // long soft tail — hides the sprite's circular edge
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      return new THREE.CanvasTexture(canvas);
    };

    const layers: { tex: THREE.CanvasTexture; scale: number; opacity: number }[] = [
      { tex: makeHaloTexture(0.25, '255, 235, 190'), scale: 3.2, opacity: 0.85 },
      { tex: makeHaloTexture(0.15, '255, 190, 110'), scale: 7.0, opacity: 0.22 },
    ];
    for (const { tex, scale, opacity } of layers) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const s = sunRadiusUnits * scale;
      sprite.scale.set(s, s, 1);
      group.add(sprite);
    }
    return group;
  }

  /**
   * Fresnel atmosphere rim: a slightly larger shell that glows at the limb
   * and fades to transparent face-on, weighted toward the sunlit side.
   */
  private createAtmosphere(bodyRadiusUnits: number, colorHex: string): THREE.Mesh {
    // Thin shell + low intensity + tight rim falloff: a subtle limb haze that
    // never competes with the planet surface itself.
    const geometry = new THREE.SphereGeometry(bodyRadiusUnits * 1.025, 64, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(colorHex) },
        intensity: { value: 0.3 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPosW;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          vPosW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        uniform float intensity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPosW;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 4.5);
          // Sun sits at the origin: fade the rim on the night side.
          // vNormal is view-space, so rotate the world-space sun direction into view space.
          vec3 sunDir = normalize(-vPosW);
          float day = clamp(dot(normalize(vNormal), (viewMatrix * vec4(sunDir, 0.0)).xyz), -1.0, 1.0) * 0.5 + 0.5;
          float glow = rim * intensity * (0.25 + 0.75 * day);
          gl_FragColor = vec4(glowColor, glow);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    return new THREE.Mesh(geometry, material);
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
      mat.uniforms.dayMap.value = this.prepColorTexture(texture);
    });
    // Load night texture
    this.textureLoader.load(`${base}textures/earth_night.jpg`, (texture) => {
      mat.uniforms.nightMap.value = this.prepColorTexture(texture);
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
    sky.name = 'skybox';
    this.skyMesh = sky;
    this.scene.add(sky);

    this.textureLoader.load(
      `${import.meta.env.BASE_URL}textures/milkyway.jpg`,
      (texture) => {
        this.prepColorTexture(texture);
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

    this.createPointStars();
  }

  /**
   * Crisp point-sprite stars layered inside the skybox. The Milky Way texture
   * alone goes soft when stretched across the sky; these keep the sky sharp.
   * Fixed screen-size points with per-star size, tint, and a slow twinkle.
   */
  private createPointStars(): void {
    const STAR_COUNT = 6000;
    const radius = STARFIELD_RADIUS * 0.96;

    // Weighted stellar palette: mostly white/blue-white, a few warm stars
    const palette: { color: THREE.Color; weight: number }[] = [
      { color: new THREE.Color('#cad8ff'), weight: 0.25 }, // blue-white
      { color: new THREE.Color('#f8f7ff'), weight: 0.4 },  // white
      { color: new THREE.Color('#fff4e8'), weight: 0.2 },  // yellow-white
      { color: new THREE.Color('#ffd2a1'), weight: 0.1 },  // orange
      { color: new THREE.Color('#ffb56b'), weight: 0.05 }, // red-orange
    ];
    const pickColor = (r: number): THREE.Color => {
      let acc = 0;
      for (const p of palette) {
        acc += p.weight;
        if (r <= acc) return p.color;
      }
      return palette[1].color;
    };

    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const phases = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform distribution on a sphere
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = radius * s * Math.cos(theta);
      positions[i * 3 + 1] = radius * u;
      positions[i * 3 + 2] = radius * s * Math.sin(theta);

      const c = pickColor(Math.random());
      // Brightness variation: many dim stars, few bright ones (power curve)
      const brightness = 0.3 + 0.7 * Math.pow(Math.random(), 3);
      colors[i * 3] = c.r * brightness;
      colors[i * 3 + 1] = c.g * brightness;
      colors[i * 3 + 2] = c.b * brightness;

      sizes[i] = 1.0 + Math.pow(Math.random(), 4) * 3.0; // px; rare large stars
      phases[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute float phase;
        uniform float time;
        uniform float pixelRatio;
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vColor = color;
          // Subtle slow twinkle, stronger on small stars
          vTwinkle = 0.82 + 0.18 * sin(time * (0.5 + fract(phase) * 1.5) + phase * 7.0);
          gl_PointSize = size * pixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float alpha = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(vColor * vTwinkle, alpha);
        }
      `,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const stars = new THREE.Points(geometry, this.starMaterial);
    stars.name = 'point-stars';
    this.pointStars = stars;
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
