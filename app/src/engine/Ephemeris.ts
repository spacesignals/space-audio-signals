import * as Astronomy from 'astronomy-engine';
import { KM_PER_UNIT } from '../data/constants';

// Map our body IDs to astronomy-engine body names
const BODY_MAP: Record<string, Astronomy.Body> = {
  mercury: Astronomy.Body.Mercury,
  venus: Astronomy.Body.Venus,
  earth: Astronomy.Body.Earth,
  mars: Astronomy.Body.Mars,
  jupiter: Astronomy.Body.Jupiter,
  saturn: Astronomy.Body.Saturn,
  uranus: Astronomy.Body.Uranus,
  neptune: Astronomy.Body.Neptune,
};

// AU to km
const AU_TO_KM = 149_597_870.7;

/**
 * Ephemeris computes real-time positions of solar system bodies
 * using the astronomy-engine library (client-side, no server needed).
 */
export class Ephemeris {
  private positions: Map<string, [number, number, number]> = new Map();
  private lastUpdateTime = 0;
  private updateIntervalMs = 1000; // Update positions at 1Hz

  constructor() {
    // Sun is always at origin
    this.positions.set('sun', [0, 0, 0]);
  }

  /**
   * Update body positions if enough time has passed.
   * Returns positions in Three.js units.
   */
  update(now: number): Map<string, [number, number, number]> {
    if (now - this.lastUpdateTime < this.updateIntervalMs) {
      return this.positions;
    }
    this.lastUpdateTime = now;

    const date = new Date();

    for (const [bodyId, astroBody] of Object.entries(BODY_MAP)) {
      try {
        // Get heliocentric ecliptic position in AU
        const vec = Astronomy.HelioVector(astroBody, date);

        // Convert AU -> km -> Three.js units
        const x = (vec.x * AU_TO_KM) / KM_PER_UNIT;
        const y = (vec.z * AU_TO_KM) / KM_PER_UNIT; // astronomy-engine z = our y (up)
        const z = (vec.y * AU_TO_KM) / KM_PER_UNIT; // astronomy-engine y = our z

        this.positions.set(bodyId, [x, y, z]);
      } catch (err) {
        // Fallback: keep last known position or use zero
        if (!this.positions.has(bodyId)) {
          this.positions.set(bodyId, [0, 0, 0]);
        }
        console.warn(`Ephemeris error for ${bodyId}:`, err);
      }
    }

    return this.positions;
  }

  getPosition(bodyId: string): [number, number, number] | undefined {
    return this.positions.get(bodyId);
  }

  getAllPositions(): Map<string, [number, number, number]> {
    return this.positions;
  }
}
