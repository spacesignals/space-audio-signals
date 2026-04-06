import { describe, it, expect } from 'vitest';
import { formatDistance, formatSpeed } from './format';

describe('formatDistance', () => {
  it('shows AU for distances over 1 billion km', () => {
    expect(formatDistance(1.5e9)).toContain('AU');
    expect(formatDistance(1.5e9)).toBe('10.03 AU');
  });

  it('shows M km for distances between 1M and 1B km', () => {
    expect(formatDistance(5e6)).toBe('5.0M km');
    expect(formatDistance(500e6)).toBe('500.0M km');
  });

  it('shows km for distances under 1M km', () => {
    expect(formatDistance(500_000)).toContain('km');
    expect(formatDistance(500_000)).not.toContain('M');
    expect(formatDistance(500_000)).not.toContain('AU');
  });

  it('formats small distances with locale separators', () => {
    const result = formatDistance(1234);
    // Should contain the number (locale formatting varies)
    expect(result).toContain('km');
  });

  it('handles zero distance', () => {
    expect(formatDistance(0)).toContain('0');
    expect(formatDistance(0)).toContain('km');
  });

  it('boundary: exactly 1 billion km', () => {
    // 1e9 is not > 1e9, so should show M km
    expect(formatDistance(1e9)).toContain('M km');
  });

  it('boundary: just over 1 billion km', () => {
    expect(formatDistance(1e9 + 1)).toContain('AU');
  });

  it('boundary: exactly 1 million km', () => {
    // 1e6 is not > 1e6, so should show plain km
    expect(formatDistance(1e6)).not.toContain('M');
  });
});

describe('formatSpeed', () => {
  it('shows AU/min for high speeds', () => {
    // speedUnitsPerSec * KM_PER_UNIT = km/s. If km/s > 1e6, show AU/min.
    // 2 units/sec * 1e6 = 2e6 km/s > 1e6 threshold
    const result = formatSpeed(2);
    expect(result).toContain('AU/min');
  });

  it('shows k km/s for lower speeds', () => {
    // 0.5 units/sec * 1e6 = 5e5 km/s < 1e6 threshold
    const result = formatSpeed(0.5);
    expect(result).toContain('k km/s');
  });

  it('handles zero speed', () => {
    expect(formatSpeed(0)).toContain('0');
  });

  it('boundary: exactly 1 unit/sec', () => {
    // 1 * 1e6 = 1e6 km/s, not > 1e6, so k km/s
    const result = formatSpeed(1);
    expect(result).toContain('k km/s');
  });
});
