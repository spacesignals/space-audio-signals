import { describe, it, expect } from 'vitest';
import { resolveLabelOverlaps, type LabelRect } from './Labels';

const rect = (partial: Partial<LabelRect> & { id: string }): LabelRect => ({
  priority: 1,
  distance: 100,
  x: 0,
  y: 0,
  w: 80,
  h: 18,
  ...partial,
});

describe('resolveLabelOverlaps', () => {
  it('keeps non-overlapping labels', () => {
    const hidden = resolveLabelOverlaps([
      rect({ id: 'earth', x: 0 }),
      rect({ id: 'mars', x: 200 }),
    ]);
    expect(hidden.size).toBe(0);
  });

  it('hides the lower-priority label on collision (planet beats moon)', () => {
    const hidden = resolveLabelOverlaps([
      rect({ id: 'moon', priority: 3, x: 10 }),
      rect({ id: 'earth', priority: 1, x: 0 }),
    ]);
    expect(hidden.has('moon')).toBe(true);
    expect(hidden.has('earth')).toBe(false);
  });

  it('nearer body wins ties within the same priority class', () => {
    const hidden = resolveLabelOverlaps([
      rect({ id: 'far-moon', priority: 3, distance: 500, x: 0 }),
      rect({ id: 'near-moon', priority: 3, distance: 50, x: 12 }),
    ]);
    expect(hidden.has('far-moon')).toBe(true);
    expect(hidden.has('near-moon')).toBe(false);
  });

  it('labels far apart vertically do not collide even at the same x', () => {
    const hidden = resolveLabelOverlaps([
      rect({ id: 'a', x: 0, y: 0 }),
      rect({ id: 'b', x: 0, y: 40 }),
    ]);
    expect(hidden.size).toBe(0);
  });
});
