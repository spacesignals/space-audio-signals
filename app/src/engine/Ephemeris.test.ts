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

  it('interpolates astronomy-body positions smoothly between 1Hz samples', () => {
    const eph = new Ephemeris();
    const t0 = 100_000;
    // Realistic pair: samples one real second apart, sim time advancing ~2 days
    // (fast time-lapse). Earth moves ~2 degrees — the interpolation chord hugs
    // the orbit, matching how the live system feeds sim time each frame.
    const s0 = Date.UTC(2026, 0, 1);
    const s1 = Date.UTC(2026, 0, 3);
    eph.update(t0, s0);
    eph.update(t0 + 1000, s1); // establishes prev (s0) / curr (s1) pair

    const dist = (p: [number, number, number]) => Math.hypot(p[0], p[1], p[2]);
    const grab = (dt: number) =>
      [...eph.update(t0 + 1000 + dt, s1)!.get('earth')!] as [number, number, number];

    const early = grab(1);    // essentially the previous sample
    const mid = grab(500);    // halfway to the next sample
    const late = grab(1000);  // next full sample boundary

    // Position moves each frame (no 1Hz hop) and progresses monotonically
    const dEarlyMid = Math.hypot(mid[0] - early[0], mid[1] - early[1], mid[2] - early[2]);
    const dMidLate = Math.hypot(late[0] - mid[0], late[1] - mid[1], late[2] - mid[2]);
    expect(dEarlyMid).toBeGreaterThan(0);
    expect(dMidLate).toBeGreaterThan(0);
    // Earth stays at ~1 AU (~150 units) throughout — no interpolation blowup
    expect(dist(mid)).toBeGreaterThan(120);
    expect(dist(mid)).toBeLessThan(170);
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
