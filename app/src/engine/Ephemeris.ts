import * as Astronomy from 'astronomy-engine';
import { KM_PER_UNIT, BODY_VISUAL_SCALE } from '../data/constants';
import { MOON_ORBITS, ASTEROID_ORBITS, BODIES } from '../data/bodies';

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
  pluto: Astronomy.Body.Pluto,
  moon: Astronomy.Body.Moon,
};

// AU to km
const AU_TO_KM = 149_597_870.7;

// Reference epoch for moon orbit phase calculation
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MS_PER_DAY = 86_400_000;

// moonId -> parent bodyId, derived once from BODIES config
const PARENT_MAP: Record<string, string> = {};
for (const body of BODIES) {
  if (body.parentId) PARENT_MAP[body.id] = body.parentId;
}

/**
 * Ephemeris computes real-time positions of solar system bodies
 * using the astronomy-engine library (client-side, no server needed).
 *
 * Planets + Pluto: real positions via astronomy-engine.
 * Earth's Moon: real position via astronomy-engine (geocentric, converted to heliocentric).
 * Other moons: simple circular orbits around their parent planet.
 */
export class Ephemeris {
  private positions: Map<string, [number, number, number]> = new Map();
  private lastUpdateTime = -Infinity;
  private updateIntervalMs = 1000; // astronomy-engine bodies update at 1Hz

  constructor() {
    // Sun is always at origin
    this.positions.set('sun', [0, 0, 0]);
  }

  /**
   * Update body positions. Called every frame.
   *
   * Planets + Pluto + Earth's Moon (astronomy-engine) update at 1Hz — they
   * move slowly enough that per-tick jumps are invisible. Circular-orbit
   * moons and asteroids update EVERY frame: fast inner moons (Phobos orbits
   * in 7.7h) visibly jump at 1Hz when the camera is orbiting them up close.
   *
   * Returns positions in Three.js units.
   */
  update(now: number): Map<string, [number, number, number]> {
    if (now - this.lastUpdateTime >= this.updateIntervalMs) {
      this.lastUpdateTime = now;
      this.updateAstronomyBodies(new Date());
    }
    this.updateCircularOrbits(Date.now());
    return this.positions;
  }

  /** Planets, Pluto, and Earth's Moon via astronomy-engine (1Hz). */
  private updateAstronomyBodies(date: Date): void {
    for (const [bodyId, astroBody] of Object.entries(BODY_MAP)) {
      try {
        if (bodyId === 'moon') {
          // Moon is geocentric in astronomy-engine — add Earth's position
          const earthPos = this.positions.get('earth');
          if (!earthPos) continue;
          const geoVec = Astronomy.GeoVector(Astronomy.Body.Moon, date, true);
          const x = earthPos[0] + (geoVec.x * AU_TO_KM) / KM_PER_UNIT * BODY_VISUAL_SCALE;
          const y = earthPos[1] + (geoVec.z * AU_TO_KM) / KM_PER_UNIT * BODY_VISUAL_SCALE;
          const z = earthPos[2] + (geoVec.y * AU_TO_KM) / KM_PER_UNIT * BODY_VISUAL_SCALE;
          this.positions.set('moon', [x, y, z]);
          continue;
        }

        // Get heliocentric ecliptic position in AU
        const vec = Astronomy.HelioVector(astroBody, date);

        // Convert AU -> km -> Three.js units
        const x = (vec.x * AU_TO_KM) / KM_PER_UNIT;
        const y = (vec.z * AU_TO_KM) / KM_PER_UNIT; // astronomy-engine z = our y (up)
        const z = (vec.y * AU_TO_KM) / KM_PER_UNIT; // astronomy-engine y = our z

        this.positions.set(bodyId, [x, y, z]);
      } catch (err) {
        if (!this.positions.has(bodyId)) {
          this.positions.set(bodyId, [0, 0, 0]);
        }
        console.warn(`Ephemeris error for ${bodyId}:`, err);
      }
    }

  }

  /** Circular-orbit moons + asteroids (every frame — cheap trig). */
  private updateCircularOrbits(nowMs: number): void {
    const daysSinceJ2000 = (nowMs - J2000_MS) / MS_PER_DAY;

    for (const [moonId, orbit] of Object.entries(MOON_ORBITS)) {
      if (moonId === 'moon') continue; // handled above via astronomy-engine

      const parentId = PARENT_MAP[moonId];
      const parentPos = parentId ? this.positions.get(parentId) : undefined;
      if (!parentPos) continue;

      // Simple circular orbit — scaled to match visual body scale
      const angle = (2 * Math.PI * daysSinceJ2000) / orbit.periodDays;
      const radiusUnits = (orbit.semiMajorAxisKm / KM_PER_UNIT) * BODY_VISUAL_SCALE;

      const x = parentPos[0] + Math.cos(angle) * radiusUnits;
      const y = parentPos[1]; // moons orbit in ecliptic plane (simplified)
      const z = parentPos[2] + Math.sin(angle) * radiusUnits;

      this.positions.set(moonId, [x, y, z]);
    }

    // Asteroids and dwarf planets on simple solar orbits
    for (const [id, orbit] of Object.entries(ASTEROID_ORBITS)) {
      const angle = (2 * Math.PI * daysSinceJ2000) / orbit.periodDays;
      const radiusUnits = (orbit.semiMajorAxisAU * AU_TO_KM) / KM_PER_UNIT;
      const incRad = (orbit.inclination * Math.PI) / 180;

      const x = Math.cos(angle) * radiusUnits;
      const y = Math.sin(incRad) * Math.sin(angle) * radiusUnits;
      const z = Math.sin(angle) * radiusUnits * Math.cos(incRad);

      this.positions.set(id, [x, y, z]);
    }
  }

  getPosition(bodyId: string): [number, number, number] | undefined {
    return this.positions.get(bodyId);
  }

  getAllPositions(): Map<string, [number, number, number]> {
    return this.positions;
  }
}
