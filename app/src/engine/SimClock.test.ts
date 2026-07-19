import { describe, it, expect } from 'vitest';
import { SimClock, TIME_RATES, LIVE_RATE_INDEX } from './SimClock';

/** Controllable wall clock. */
function makeWall(startMs = 1_000_000_000_000) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

describe('SimClock', () => {
  it('starts live, pinned to the wall clock', () => {
    const wall = makeWall();
    const clock = new SimClock(wall.now);
    expect(clock.isLive()).toBe(true);
    wall.advance(5000);
    clock.tick(5);
    expect(clock.getSimMs()).toBe(wall.now());
    expect(clock.getRateLabel()).toBe('live');
  });

  it('stepRate leaves live mode and advances at the selected rate', () => {
    const wall = makeWall();
    const clock = new SimClock(wall.now);
    clock.stepRate(1); // 1 min/s
    expect(clock.isLive()).toBe(false);
    expect(clock.getRate()).toBe(60);

    const before = clock.getSimMs();
    clock.tick(2); // 2 real seconds at 60x = 120 sim-seconds
    expect(clock.getSimMs() - before).toBe(120_000);
  });

  it('stepping down from live goes into reverse rates', () => {
    const wall = makeWall();
    const clock = new SimClock(wall.now);
    clock.stepRate(-1);
    expect(clock.getRate()).toBe(-60);
    const before = clock.getSimMs();
    clock.tick(1);
    expect(clock.getSimMs() - before).toBe(-60_000);
  });

  it('rate steps are clamped at the table ends', () => {
    const wall = makeWall();
    const clock = new SimClock(wall.now);
    for (let i = 0; i < 20; i++) clock.stepRate(1);
    expect(clock.getRate()).toBe(TIME_RATES[TIME_RATES.length - 1].rate);
    for (let i = 0; i < 40; i++) clock.stepRate(-1);
    expect(clock.getRate()).toBe(TIME_RATES[0].rate);
  });

  it('goLive eases smoothly back to the wall clock (no teleport)', () => {
    const wall = makeWall();
    const clock = new SimClock(wall.now);
    clock.stepRate(1); clock.stepRate(1); clock.stepRate(1); // 1 day/s
    clock.tick(10); // scrub 10 days ahead
    const scrubbedOffset = clock.getSimMs() - wall.now();
    expect(scrubbedOffset).toBe(864_000_000);

    clock.goLive();
    expect(clock.isEasing()).toBe(true);

    // Mid-ease: offset should have shrunk but not vanished
    clock.tick(0.5);
    const midOffset = clock.getSimMs() - wall.now();
    expect(Math.abs(midOffset)).toBeLessThan(Math.abs(scrubbedOffset));
    expect(Math.abs(midOffset)).toBeGreaterThan(0);

    // Complete the ease
    clock.tick(1.0);
    expect(clock.isLive()).toBe(true);
    expect(clock.getSimMs()).toBe(wall.now());
    expect(clock.getRate()).toBe(1);
  });

  it('goLive with a tiny offset snaps without easing', () => {
    const wall = makeWall();
    const clock = new SimClock(wall.now);
    clock.stepRate(1); // 1 min/s
    clock.tick(0.01); // 600ms sim offset
    clock.goLive();
    expect(clock.isEasing()).toBe(false);
    expect(clock.isLive()).toBe(true);
  });

  it('clamps scrubbing to ±100 years around now', () => {
    const wall = makeWall();
    const clock = new SimClock(wall.now);
    for (let i = 0; i < 10; i++) clock.stepRate(1); // max rate: 1 mo/s
    // 100 years at 1 month/s ≈ 1200s — scrub way past it
    clock.tick(100_000);
    const offsetYears = (clock.getSimMs() - wall.now()) / (365.25 * 86_400_000);
    expect(offsetYears).toBeCloseTo(100, 1);
  });

  it('LIVE_RATE_INDEX points at 1x', () => {
    expect(TIME_RATES[LIVE_RATE_INDEX].rate).toBe(1);
  });
});
