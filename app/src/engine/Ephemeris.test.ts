import { describe, it, expect } from 'vitest';
import { Ephemeris } from './Ephemeris';

describe('Ephemeris', () => {
  it('sun is always at origin', () => {
    const eph = new Ephemeris();
    const positions = eph.update(performance.now());
    expect(positions.get('sun')).toEqual([0, 0, 0]);
  });

  it('returns positions for all 8 planets', () => {
    const eph = new Ephemeris();
    // Use a large timestamp to ensure the 1Hz throttle doesn't skip the first real update
    const positions = eph.update(100_000);
    const planets = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
    for (const id of planets) {
      expect(positions.has(id)).toBe(true);
      const pos = positions.get(id)!;
      expect(pos).toHaveLength(3);
      expect(typeof pos[0]).toBe('number');
      expect(typeof pos[1]).toBe('number');
      expect(typeof pos[2]).toBe('number');
    }
  });

  it('planet positions are non-zero', () => {
    const eph = new Ephemeris();
    const positions = eph.update(100_000);
    for (const [id, pos] of positions) {
      if (id === 'sun') continue;
      const dist = Math.sqrt(pos[0] ** 2 + pos[1] ** 2 + pos[2] ** 2);
      expect(dist).toBeGreaterThan(0);
    }
  });

  it('inner planets are closer to sun than outer planets', () => {
    const eph = new Ephemeris();
    const positions = eph.update(100_000);

    const dist = (id: string) => {
      const p = positions.get(id)!;
      return Math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2);
    };

    // Mercury should be closer than Neptune (always true regardless of orbital phase)
    expect(dist('mercury')).toBeLessThan(dist('neptune'));
    // Earth closer than Jupiter
    expect(dist('earth')).toBeLessThan(dist('jupiter'));
  });

  it('does not update positions within 1 second', () => {
    const eph = new Ephemeris();
    const now = 100_000;
    const pos1 = eph.update(now);
    const pos2 = eph.update(now + 500);
    // Same map reference (no update happened)
    expect(pos1).toBe(pos2);
  });

  it('updates positions after 1 second', () => {
    const eph = new Ephemeris();
    const now = 100_000;
    eph.update(now);
    const pos2 = eph.update(now + 1100);
    // Should still have all bodies
    expect(pos2.size).toBeGreaterThanOrEqual(9);
  });

  it('getPosition returns undefined for unknown body', () => {
    const eph = new Ephemeris();
    eph.update(100_000);
    expect(eph.getPosition('alpha-centauri')).toBeUndefined();
  });

  it('getPosition returns value for known body', () => {
    const eph = new Ephemeris();
    eph.update(100_000);
    const pos = eph.getPosition('earth');
    expect(pos).toBeDefined();
    expect(pos).toHaveLength(3);
  });
});
