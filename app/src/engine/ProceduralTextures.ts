import * as THREE from 'three';

/**
 * Procedural equirectangular texture maps for celestial bodies.
 * Uses value noise with domain warping for organic, detailed surfaces.
 */

const WIDTH = 2048;
const HEIGHT = 1024;

// Hash-based value noise for better randomness than sin/cos
function hash(x: number, y: number, seed: number): number {
  let h = (seed * 374761393 + x * 668265263 + y * 2147483647) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  h = ((h ^ (h >> 16)) * 1221222337) | 0;
  return (h & 0x7fffffff) / 0x7fffffff;
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smoothstep
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = hash(ix, iy, seed);
  const n10 = hash(ix + 1, iy, seed);
  const n01 = hash(ix, iy + 1, seed);
  const n11 = hash(ix + 1, iy + 1, seed);

  return n00 * (1 - sx) * (1 - sy) + n10 * sx * (1 - sy) +
         n01 * (1 - sx) * sy + n11 * sx * sy;
}

function fbm(x: number, y: number, octaves: number, seed: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxVal = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * smoothNoise(x * frequency, y * frequency, seed + i * 31);
    maxVal += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03; // slight irrational ratio avoids grid artifacts
  }
  return value / maxVal;
}

// Domain-warped fbm for more organic shapes
function warpedFbm(x: number, y: number, octaves: number, seed: number, warpStrength: number): number {
  const wx = fbm(x + 1.7, y + 9.2, 4, seed + 100) * warpStrength;
  const wy = fbm(x + 8.3, y + 2.8, 4, seed + 200) * warpStrength;
  return fbm(x + wx, y + wy, octaves, seed);
}

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData } {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(WIDTH, HEIGHT);
  return { canvas, ctx, img };
}

function finalize(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, img: ImageData): THREE.CanvasTexture {
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Apply contrast boost: pulls values away from midpoint
function contrastBoost(v: number, amount: number): number {
  const normalized = v / 255;
  const boosted = ((normalized - 0.5) * amount + 0.5);
  return Math.max(0, Math.min(255, boosted * 255));
}

function setPixel(img: ImageData, x: number, y: number, r: number, g: number, b: number, contrast = 1.3): void {
  const i = (y * WIDTH + x) * 4;
  img.data[i]     = contrastBoost(Math.max(0, Math.min(255, r)), contrast);
  img.data[i + 1] = contrastBoost(Math.max(0, Math.min(255, g)), contrast);
  img.data[i + 2] = contrastBoost(Math.max(0, Math.min(255, b)), contrast);
  img.data[i + 3] = 255;
}

export function generateSunTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 12;
      const v = y / HEIGHT * 6;
      // Multiple warped layers for turbulent plasma look
      const n1 = warpedFbm(u, v, 7, 1, 2.0);
      const n2 = warpedFbm(u * 2, v * 2, 5, 10, 1.5);
      const n3 = fbm(u * 4, v * 4, 4, 20);
      // Dark sunspot regions
      const spots = warpedFbm(u * 0.8, v * 0.8, 5, 30, 3.0);
      const sunspot = spots > 0.62 ? (spots - 0.62) * 4 : 0;

      const r = 230 - sunspot * 150 + (n2 - 0.5) * 60;
      const g = 100 + n1 * 100 - sunspot * 140 + (n3 - 0.5) * 40;
      const b = 5 + n2 * 25 + n3 * 15 - sunspot * 80;
      setPixel(img, x, y, r, g, b, 1.8);
    }
  }
  return finalize(canvas, ctx, img);
}

export function generateMercuryTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 16;
      const v = y / HEIGHT * 8;
      const terrain = warpedFbm(u, v, 7, 40, 1.0);
      const craters = fbm(u * 3, v * 3, 5, 45);
      const fine = fbm(u * 8, v * 8, 3, 48);
      // Crater rims are bright, centers are dark
      const craterDepth = craters > 0.55 ? (craters - 0.55) * 5 : 0;
      const craterRim = (craters > 0.52 && craters < 0.56) ? 0.3 : 0;

      const base = 90 + terrain * 80 + fine * 20 - craterDepth * 40 + craterRim * 50;
      setPixel(img, x, y, base * 1.0, base * 0.95, base * 0.88);
    }
  }
  return finalize(canvas, ctx, img);
}

export function generateVenusTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 10;
      const v = y / HEIGHT * 5;
      // Heavy domain warping for swirling clouds
      const n1 = warpedFbm(u, v, 7, 60, 3.0);
      const n2 = warpedFbm(u * 1.5 + n1 * 0.5, v * 1.5, 5, 65, 2.0);
      const bands = Math.sin(v * 1.2 * Math.PI + n1 * 4) * 0.3 + 0.5;

      const brightness = 0.55 + n1 * 0.25 + bands * 0.15 + n2 * 0.1;
      setPixel(img, x, y, brightness * 240, brightness * 200, brightness * 130);
    }
  }
  return finalize(canvas, ctx, img);
}

export function generateMarsTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 14;
      const v = y / HEIGHT * 7;
      const vNorm = y / HEIGHT;
      const terrain = warpedFbm(u, v, 7, 80, 1.5);
      const detail = fbm(u * 3, v * 3, 5, 85);
      const channels = warpedFbm(u * 2, v * 2, 4, 88, 2.0);
      // Valles Marineris-like dark channel
      const channel = channels > 0.45 && channels < 0.52 ? 0.3 : 0;
      // Polar ice caps (smooth transition)
      const ice = Math.max(0, 1 - Math.abs(vNorm - 0.03) * 15) + Math.max(0, 1 - Math.abs(vNorm - 0.97) * 15);
      // Highlands vs lowlands
      const highlands = terrain > 0.55 ? 1.0 : 0.7;

      const r = (140 + terrain * 70 + detail * 25) * highlands - channel * 30 + ice * 100;
      const g = (60 + terrain * 40 + detail * 15) * highlands - channel * 20 + ice * 100;
      const b = (20 + terrain * 15 + detail * 10) - channel * 10 + ice * 100;
      setPixel(img, x, y, r, g, b);
    }
  }
  return finalize(canvas, ctx, img);
}

export function generateJupiterTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 12;
      const v = y / HEIGHT;
      // Strong horizontal bands with turbulent edges
      const bandFreq = v * Math.PI * 22;
      const turb = warpedFbm(u, v * 8, 6, 100, 1.5);
      const bands = Math.sin(bandFreq + turb * 3) * 0.5 + 0.5;
      const fineBands = Math.sin(bandFreq * 3 + turb * 2) * 0.2;
      const detail = fbm(u * 3, v * 20, 4, 105);

      // Great Red Spot
      const spotU = ((x / WIDTH) - 0.6 + 1) % 1;
      const spotV = v - 0.58;
      const spotDist = Math.sqrt(spotU * spotU * 16 + spotV * spotV * 64);
      const spot = Math.max(0, 1 - spotDist * 6);
      const spotSwirl = fbm(spotU * 30 + spot * 2, spotV * 30, 4, 108);

      const bright = 0.4 + bands * 0.35 + fineBands + detail * 0.1;
      const r = bright * 230 + spot * 60 + spotSwirl * spot * 20;
      const g = bright * 185 - bands * 25 + spot * 15;
      const b = bright * 120 - bands * 40 - spot * 20;
      setPixel(img, x, y, r, g, b);
    }
  }
  return finalize(canvas, ctx, img);
}

export function generateSaturnTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 10;
      const v = y / HEIGHT;
      // Subtle bands with slight turbulence
      const turb = warpedFbm(u, v * 6, 5, 120, 0.8);
      const bands = Math.sin(v * Math.PI * 18 + turb * 1.5) * 0.2 + 0.8;
      const fineBands = Math.sin(v * Math.PI * 45 + turb) * 0.08;
      const detail = fbm(u * 2, v * 12, 4, 125);

      const bright = 0.6 + bands * 0.2 + fineBands + detail * 0.08;
      setPixel(img, x, y, bright * 245, bright * 220, bright * 165);
    }
  }
  return finalize(canvas, ctx, img);
}

export function generateUranusTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 8;
      const v = y / HEIGHT;
      const n = warpedFbm(u, v * 4, 6, 140, 0.6);
      const bands = Math.sin(v * Math.PI * 12 + n * 1.5) * 0.08 + 0.92;
      const detail = fbm(u * 3, v * 8, 4, 145);
      // Slight polar darkening
      const polar = 1 - Math.pow(Math.abs(v - 0.5) * 2, 3) * 0.15;

      const bright = (0.65 + n * 0.2 + bands * 0.1 + detail * 0.05) * polar;
      setPixel(img, x, y, bright * 150, bright * 215, bright * 225);
    }
  }
  return finalize(canvas, ctx, img);
}

export function generateNeptuneTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 10;
      const v = y / HEIGHT;
      const n = warpedFbm(u, v * 5, 6, 160, 1.2);
      const bands = Math.sin(v * Math.PI * 14 + n * 2) * 0.12 + 0.88;
      const detail = fbm(u * 3, v * 10, 4, 165);
      // Dark spot (like the Great Dark Spot)
      const spotU = ((x / WIDTH) - 0.3 + 1) % 1;
      const spotV = v - 0.45;
      const spotDist = Math.sqrt(spotU * spotU * 20 + spotV * spotV * 80);
      const darkSpot = Math.max(0, 1 - spotDist * 8) * 0.2;

      const bright = 0.45 + n * 0.2 + bands * 0.15 + detail * 0.08 - darkSpot;
      setPixel(img, x, y, bright * 70, bright * 110, bright * 245);
    }
  }
  return finalize(canvas, ctx, img);
}

export function generateMoonTexture(): THREE.CanvasTexture {
  const { canvas, ctx, img } = createCanvas();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH * 16;
      const v = y / HEIGHT * 8;
      const terrain = warpedFbm(u, v, 7, 180, 1.0);
      const craters = fbm(u * 3, v * 3, 5, 185);
      const maria = warpedFbm(u * 0.5, v * 0.5, 4, 190, 2.0);
      const fine = fbm(u * 6, v * 6, 3, 195);
      // Crater structure
      const craterDepth = craters > 0.55 ? (craters - 0.55) * 5 : 0;
      const craterRim = (craters > 0.52 && craters < 0.57) ? 0.25 : 0;
      // Dark maria regions
      const mariaShade = maria > 0.55 ? (maria - 0.55) * 1.5 : 0;

      const base = 130 + terrain * 60 + fine * 15 - craterDepth * 35 + craterRim * 40 - mariaShade * 50;
      setPixel(img, x, y, base, base * 0.98, base * 1.02);
    }
  }
  return finalize(canvas, ctx, img);
}

// Seamless noise on a sphere: sample 3D noise using spherical coords so lon wraps naturally
function sphereFbm(lon: number, lat: number, scale: number, octaves: number, seed: number): number {
  const sx = Math.cos(lon) * Math.sin(lat) * scale;
  const sy = Math.sin(lon) * Math.sin(lat) * scale;
  const sz = Math.cos(lat) * scale;
  // Use 2D fbm with two independent axes derived from 3D coords
  return fbm(sx + sz * 0.7, sy + sz * 0.3, octaves, seed);
}

function sphereWarpedFbm(lon: number, lat: number, scale: number, octaves: number, seed: number, warp: number): number {
  const wx = sphereFbm(lon, lat, scale * 0.8, 4, seed + 100) * warp;
  const wy = sphereFbm(lon, lat, scale * 0.8, 4, seed + 200) * warp;
  const sx = Math.cos(lon) * Math.sin(lat) * scale;
  const sy = Math.sin(lon) * Math.sin(lat) * scale;
  return fbm(sx + wx, sy + wy, octaves, seed);
}

/** Generate a Milky Way skybox texture — 4096x2048 equirectangular panorama. */
export function generateSkyboxTexture(): THREE.CanvasTexture {
  const W = 4096;
  const H = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);

  const seed = 42;

  for (let y = 0; y < H; y++) {
    const lat = (y / H) * Math.PI;
    const galacticDist = Math.abs(lat - Math.PI / 2) / (Math.PI / 2);

    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      const idx = (y * W + x) * 4;

      let r = 2, g = 2, b = 5;

      // Milky Way band
      const bandFalloff = Math.exp(-galacticDist * galacticDist * 8);
      const bandNoise = sphereWarpedFbm(lon, lat, 3, 6, seed, 1.5);
      const band = bandFalloff * (0.4 + bandNoise * 0.6);

      r += band * 35 * (0.8 + bandNoise * 0.4);
      g += band * 30 * (0.7 + bandNoise * 0.3);
      b += band * 40 * (0.6 + bandNoise * 0.5);

      // Dark dust lanes
      const dust = sphereWarpedFbm(lon, lat, 4, 5, seed + 300, 2.5);
      if (dust > 0.55 && bandFalloff > 0.3) {
        const darkening = (dust - 0.55) * 3 * bandFalloff;
        r *= 1 - darkening * 0.7;
        g *= 1 - darkening * 0.7;
        b *= 1 - darkening * 0.6;
      }

      // Nebula patches
      const neb1 = sphereWarpedFbm(lon, lat, 2, 5, seed + 500, 1.8);
      if (neb1 > 0.6 && bandFalloff > 0.2) {
        const nebStr = (neb1 - 0.6) * 2.5 * bandFalloff;
        r += nebStr * 15;
        g += nebStr * 5;
        b += nebStr * 20;
      }

      const neb2 = sphereWarpedFbm(lon + 3, lat + 1, 2.5, 5, seed + 600, 1.5);
      if (neb2 > 0.62 && bandFalloff > 0.15) {
        const nebStr = (neb2 - 0.62) * 2.5 * bandFalloff;
        r += nebStr * 8;
        g += nebStr * 12;
        b += nebStr * 25;
      }

      // Stars
      const starHash = hash(x, y, seed + 999);
      if (starHash > 0.997) {
        const brightness = 80 + (starHash - 0.997) * 30000;
        const starTemp = hash(x, y, seed + 1000);
        r += brightness * (starTemp < 0.3 ? 0.8 : 1.0);
        g += brightness * (starTemp < 0.3 ? 0.85 : starTemp > 0.8 ? 0.9 : 1.0);
        b += brightness * (starTemp < 0.3 ? 1.0 : starTemp > 0.8 ? 0.7 : 1.0);
      }
      if (starHash > 0.985 && starHash <= 0.997) {
        const brightness = 20 + (starHash - 0.985) * 3000;
        r += brightness;
        g += brightness;
        b += brightness * 1.1;
      }

      img.data[idx] = Math.min(255, Math.max(0, r));
      img.data[idx + 1] = Math.min(255, Math.max(0, g));
      img.data[idx + 2] = Math.min(255, Math.max(0, b));
      img.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/** Get the procedural texture for a body ID. Returns null if no generator exists. */
export function getProceduralTexture(bodyId: string): THREE.CanvasTexture | null {
  switch (bodyId) {
    case 'sun': return generateSunTexture();
    case 'mercury': return generateMercuryTexture();
    case 'venus': return generateVenusTexture();
    case 'earth': return null; // use downloaded NASA map
    case 'mars': return generateMarsTexture();
    case 'jupiter': return generateJupiterTexture();
    case 'saturn': return generateSaturnTexture();
    case 'uranus': return generateUranusTexture();
    case 'neptune': return generateNeptuneTexture();
    case 'moon': return generateMoonTexture();
    default: return null;
  }
}
