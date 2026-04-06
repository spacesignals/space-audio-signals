import { KM_PER_UNIT } from '../data/constants';

const AU_KM = 149_597_870.7;

/**
 * Format a distance in km to a human-readable string.
 * > 1 billion km → AU
 * > 1 million km → M km
 * otherwise → km with locale formatting
 */
export function formatDistance(distanceKm: number): string {
  if (distanceKm > 1e9) {
    return `${(distanceKm / AU_KM).toFixed(2)} AU`;
  } else if (distanceKm > 1e6) {
    return `${(distanceKm / 1e6).toFixed(1)}M km`;
  }
  return `${Math.round(distanceKm).toLocaleString()} km`;
}

/**
 * Format speed (in Three.js units/second) to a human-readable string.
 * > 1M km/s → AU/min
 * otherwise → k km/s
 */
export function formatSpeed(speedUnitsPerSec: number): string {
  const kmPerSec = speedUnitsPerSec * KM_PER_UNIT;
  if (kmPerSec > 1e6) {
    return `${(kmPerSec / AU_KM * 60).toFixed(1)} AU/min`;
  }
  return `${(kmPerSec / 1000).toFixed(0)}k km/s`;
}
