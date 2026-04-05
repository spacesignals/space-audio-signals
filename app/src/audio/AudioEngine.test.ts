import { describe, it, expect } from 'vitest';

/**
 * Gain curve calculations extracted for testing.
 * These mirror the logic in AudioEngine.calculateGain.
 */
function calculateGain(
  distanceKm: number,
  config: { radiusKm: number; audibilityRadiusKm: number; maxGain: number; gainCurve: string }
): number {
  const { audibilityRadiusKm, maxGain, gainCurve, radiusKm } = config;

  if (distanceKm >= audibilityRadiusKm) return 0;
  if (distanceKm <= radiusKm) return maxGain;

  const t = (distanceKm - radiusKm) / (audibilityRadiusKm - radiusKm);

  switch (gainCurve) {
    case 'logarithmic':
      return maxGain * (1 - Math.log(1 + t * 9) / Math.log(10));
    case 'inverse-square':
      return maxGain / (1 + t * t * 9);
    case 'linear':
    default:
      return maxGain * (1 - t);
  }
}

describe('Gain curves', () => {
  const earth = {
    radiusKm: 6_371,
    audibilityRadiusKm: 1e8,
    maxGain: 0.6,
    gainCurve: 'logarithmic',
  };

  it('returns maxGain at body surface', () => {
    expect(calculateGain(6_371, earth)).toBe(0.6);
  });

  it('returns maxGain inside body radius', () => {
    expect(calculateGain(1_000, earth)).toBe(0.6);
  });

  it('returns 0 at audibility edge', () => {
    expect(calculateGain(1e8, earth)).toBe(0);
  });

  it('returns 0 beyond audibility radius', () => {
    expect(calculateGain(2e8, earth)).toBe(0);
  });

  it('logarithmic: gain decreases monotonically with distance', () => {
    const distances = [10_000, 1e6, 1e7, 5e7, 9e7];
    const gains = distances.map(d => calculateGain(d, earth));
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeLessThan(gains[i - 1]);
    }
  });

  it('logarithmic: drops faster near body, converges at edges', () => {
    // This log curve (log(1+9t)/log(10)) drops faster than linear early on
    // but both reach 0 at the edge. Verify the shape is distinct from linear.
    const near = earth.radiusKm + (earth.audibilityRadiusKm - earth.radiusKm) * 0.1;
    const logGain = calculateGain(near, { ...earth, gainCurve: 'logarithmic' });
    const linGain = calculateGain(near, { ...earth, gainCurve: 'linear' });
    // At 10%, log and linear differ (log drops faster)
    expect(logGain).not.toBeCloseTo(linGain, 1);
    // Log is less than linear at this point (steeper initial drop)
    expect(logGain).toBeLessThan(linGain);
  });

  it('linear: gain is exactly half at midpoint', () => {
    const linearConfig = { ...earth, gainCurve: 'linear' };
    const midpoint = (earth.radiusKm + earth.audibilityRadiusKm) / 2;
    const gain = calculateGain(midpoint, linearConfig);
    expect(gain).toBeCloseTo(earth.maxGain * 0.5, 5);
  });

  it('inverse-square: gain decreases but stays above zero until edge', () => {
    const isConfig = { ...earth, gainCurve: 'inverse-square' };
    const gain = calculateGain(earth.audibilityRadiusKm * 0.99, isConfig);
    expect(gain).toBeGreaterThan(0);
  });

  it('all curves return values in [0, maxGain]', () => {
    const curves = ['logarithmic', 'linear', 'inverse-square'];
    const distances = [0, 100, 1000, 1e5, 1e6, 1e7, 5e7, 9.9e7, 1e8, 2e8];
    for (const curve of curves) {
      for (const d of distances) {
        const g = calculateGain(d, { ...earth, gainCurve: curve });
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(earth.maxGain);
      }
    }
  });

  it('handles zero-radius body', () => {
    const pointBody = { ...earth, radiusKm: 0 };
    expect(calculateGain(0, pointBody)).toBe(0.6);
    expect(calculateGain(5e7, pointBody)).toBeGreaterThan(0);
  });
});
