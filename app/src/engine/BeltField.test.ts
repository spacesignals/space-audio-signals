import { describe, it, expect } from 'vitest';
import { mulberry32, keplerPeriodDays } from './BeltField';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds diverge', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('keplerPeriodDays', () => {
  it('1 AU orbits in one Earth year', () => {
    expect(keplerPeriodDays(1)).toBeCloseTo(365.25, 5);
  });

  it('Ceres (2.769 AU) is ~4.6 years', () => {
    expect(keplerPeriodDays(2.769) / 365.25).toBeCloseTo(4.61, 1);
  });

  it('Pluto-ish (39 AU) is ~244 years', () => {
    expect(keplerPeriodDays(39) / 365.25).toBeCloseTo(243.6, 0);
  });
});
