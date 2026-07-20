import { describe, it, expect } from 'vitest';

/**
 * Test the math used in Navigation without needing Three.js DOM or WebGL.
 * These are pure math tests for the camera framing calculations.
 */

// Mirror of Navigation.flyTo distance calculation
function calculateFramingDistance(bodyVisualRadius: number, cameraFovDeg: number): number {
  const fovRad = (cameraFovDeg * Math.PI) / 180;
  const targetAngularFraction = 1 / 3;
  const halfTargetAngle = (fovRad * targetAngularFraction) / 2;
  return bodyVisualRadius / Math.tan(halfTargetAngle);
}

// Mirror of the cubic ease-in-out used in focus travel
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

describe('Focus travel framing', () => {
  const FOV = 60; // degrees

  it('larger bodies are framed from further away', () => {
    const distSmall = calculateFramingDistance(1, FOV);
    const distLarge = calculateFramingDistance(10, FOV);
    expect(distLarge).toBeGreaterThan(distSmall);
  });

  it('distance scales linearly with radius', () => {
    const dist1 = calculateFramingDistance(1, FOV);
    const dist5 = calculateFramingDistance(5, FOV);
    expect(dist5 / dist1).toBeCloseTo(5, 5);
  });

  it('wider FOV means closer framing distance', () => {
    const distNarrow = calculateFramingDistance(1, 40);
    const distWide = calculateFramingDistance(1, 90);
    expect(distWide).toBeLessThan(distNarrow);
  });

  it('framing distance is always positive', () => {
    const fovs = [30, 45, 60, 75, 90, 120];
    const radii = [0.01, 0.1, 1, 10, 100];
    for (const fov of fovs) {
      for (const r of radii) {
        expect(calculateFramingDistance(r, fov)).toBeGreaterThan(0);
      }
    }
  });
});

describe('Ease-in-out cubic', () => {
  it('starts at 0', () => {
    expect(easeInOutCubic(0)).toBe(0);
  });

  it('ends at 1', () => {
    expect(easeInOutCubic(1)).toBeCloseTo(1, 10);
  });

  it('midpoint is 0.5', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });

  it('is monotonically increasing', () => {
    let prev = 0;
    for (let t = 0.01; t <= 1.0; t += 0.01) {
      const val = easeInOutCubic(t);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });

  it('first half is slower than linear (ease in)', () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
  });

  it('second half is faster than linear (ease out)', () => {
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
  });

  it('values stay in [0, 1]', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const val = easeInOutCubic(t);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

describe('Tour time budgeting', () => {
  it('total time sums correctly', () => {
    const totalMs = 75_000;
    const travelFraction = 0.25;
    const n = 9; // bodies
    const travelPerBody = (totalMs * travelFraction) / n;
    const orbitPerBody = (totalMs * (1 - travelFraction)) / n;
    const total = (travelPerBody + orbitPerBody) * n;
    expect(total).toBeCloseTo(totalMs, 5);
  });

  it('orbit gets more time than travel', () => {
    const totalMs = 75_000;
    const travelFraction = 0.25;
    const n = 9;
    const travelPerBody = (totalMs * travelFraction) / n;
    const orbitPerBody = (totalMs * (1 - travelFraction)) / n;
    expect(orbitPerBody).toBeGreaterThan(travelPerBody);
  });
});

// --- speed presets (1-9) ---
import { speedForPresetKey } from './Navigation';
import { FREE_FLIGHT_SPEED_MIN, FREE_FLIGHT_SPEED_MAX, FREE_FLIGHT_SPEED } from '../data/constants';

describe('speedForPresetKey', () => {
  it('key 1 is the minimum speed, key 9 the maximum', () => {
    expect(speedForPresetKey(1)).toBeCloseTo(FREE_FLIGHT_SPEED_MIN, 10);
    expect(speedForPresetKey(9)).toBeCloseTo(FREE_FLIGHT_SPEED_MAX, 8);
  });

  it('steps are log-spaced (constant ratio between adjacent keys)', () => {
    const ratio = speedForPresetKey(2) / speedForPresetKey(1);
    for (let n = 2; n < 9; n++) {
      expect(speedForPresetKey(n + 1) / speedForPresetKey(n)).toBeCloseTo(ratio, 8);
    }
  });

  it('key 5 lands near the default cruise speed', () => {
    const mid = speedForPresetKey(5);
    expect(mid).toBeGreaterThan(FREE_FLIGHT_SPEED * 0.05);
    expect(mid).toBeLessThan(FREE_FLIGHT_SPEED * 20);
  });

  it('out-of-range keys clamp to the table', () => {
    expect(speedForPresetKey(0)).toBe(speedForPresetKey(1));
    expect(speedForPresetKey(12)).toBe(speedForPresetKey(9));
  });
});
