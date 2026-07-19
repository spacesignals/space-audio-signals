import { describe, it, expect } from 'vitest';
import { sampleAsteroidOrbit, sampleCircleOrbit } from './OrbitLines';
import { KM_PER_UNIT } from '../data/constants';

const AU_TO_KM = 149_597_870.7;

describe('sampleCircleOrbit', () => {
  it('produces points at the requested radius in the ecliptic plane', () => {
    const pts = sampleCircleOrbit(76.9, 64);
    expect(pts.length).toBe(64 * 3);
    for (let i = 0; i < 64; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      expect(y).toBe(0);
      expect(Math.sqrt(x * x + z * z)).toBeCloseTo(76.9, 3);
    }
  });
});

describe('sampleAsteroidOrbit', () => {
  it('matches the Ephemeris parametric path (radius + inclination)', () => {
    const aAU = 2.769; // Ceres
    const inc = 10.6;
    const pts = sampleAsteroidOrbit(aAU, inc, 128);
    const r = (aAU * AU_TO_KM) / KM_PER_UNIT;
    const incRad = (inc * Math.PI) / 180;

    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      expect(pts[i * 3]).toBeCloseTo(Math.cos(a) * r, 2);
      expect(pts[i * 3 + 1]).toBeCloseTo(Math.sin(incRad) * Math.sin(a) * r, 2);
      expect(pts[i * 3 + 2]).toBeCloseTo(Math.sin(a) * r * Math.cos(incRad), 2);
    }
  });

  it('zero inclination stays in the ecliptic plane', () => {
    const pts = sampleAsteroidOrbit(1.5, 0, 32);
    for (let i = 0; i < 32; i++) {
      expect(pts[i * 3 + 1]).toBeCloseTo(0, 9);
    }
  });
});
