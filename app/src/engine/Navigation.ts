import * as THREE from 'three';
import {
  FREE_FLIGHT_SPEED,
  FREE_FLIGHT_SPEED_MIN,
  FREE_FLIGHT_SPEED_MAX,
  FOCUS_TRAVEL_DURATION_MS,
  CAMERA_DRIFT_AMPLITUDE,
  CAMERA_DRIFT_FREQUENCY,
} from '../data/constants';

/**
 * Navigation handles camera movement in all modes:
 * - Free flight (WASD + mouse)
 * - Focus travel (fly to a target body)
 * - Smooth journey (guided tour through solar system)
 * - Top view (overhead view of entire system)
 */
export class Navigation {
  private camera: THREE.PerspectiveCamera;
  private mode: 'free-flight' | 'focus-travel' | 'smooth-journey' | 'top-view-travel' = 'free-flight';

  // Free flight state
  private speed = FREE_FLIGHT_SPEED;
  private keys: Set<string> = new Set();
  private mouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private yaw = 0;
  private pitch = 0;

  // Focus travel state — smooth position + orientation
  private travelStart: THREE.Vector3 | null = null;
  private travelEnd: THREE.Vector3 | null = null;
  private travelStartQuat = new THREE.Quaternion();
  private travelLookTarget: THREE.Vector3 | null = null;
  private travelStartTime = 0;
  private travelDuration = FOCUS_TRAVEL_DURATION_MS;
  private onTravelComplete: (() => void) | null = null;

  // Tour state
  private tourWaypoints: { bodyId: string; position: THREE.Vector3; visualRadius: number }[] = [];
  private tourIndex = 0;
  private tourPhase: 'travel' | 'orbit' = 'travel';
  private tourOrbitAngle = 0;
  private tourOrbitCenter: THREE.Vector3 | null = null;
  private tourOrbitRadius = 0;
  private tourOrbitStartTime = 0;
  private tourOrbitDuration = 0;
  private tourTravelDuration = 2000;
  private tourOrbitDurationPerBody = 4500;
  private tourPrevOrbitQuat = new THREE.Quaternion(); // for seamless orbit→travel blend
  private onTourComplete: (() => void) | null = null;
  private getBodyPosition: ((id: string) => THREE.Vector3 | null) | null = null;

  // Drift (zero-gravity feel)
  private driftTime = 0;
  private reducedMotion = false;

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.camera = camera;

    // Check prefers-reduced-motion
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Initialize yaw/pitch from camera's current orientation
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;

    this.setupKeyboard();
    this.setupMouse(canvas);
    this.setupTouch(canvas);
  }

  private setupKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());

      // Speed control
      if (e.key === '=' || e.key === '+') {
        this.speed = Math.min(this.speed * 1.5, FREE_FLIGHT_SPEED_MAX);
      }
      if (e.key === '-') {
        this.speed = Math.max(this.speed / 1.5, FREE_FLIGHT_SPEED_MIN);
      }

      // Any key stops tour
      if (this.mode === 'smooth-journey') {
        this.stopTour();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
  }

  private setupMouse(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', (e) => {
      if (this.mode === 'smooth-journey') {
        this.stopTour();
      }
      this.mouseDown = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.mouseDown || this.mode !== 'free-flight') return;

      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.yaw -= dx * 0.003;
      this.pitch -= dy * 0.003;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });

    // Scroll to change speed
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        this.speed = Math.min(this.speed * 1.2, FREE_FLIGHT_SPEED_MAX);
      } else {
        this.speed = Math.max(this.speed / 1.2, FREE_FLIGHT_SPEED_MIN);
      }
    }, { passive: false });
  }

  private setupTouch(canvas: HTMLCanvasElement): void {
    let lastTouchX = 0;
    let lastTouchY = 0;
    let touchStartDist = 0;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.mode === 'free-flight') {
        const dx = e.touches[0].clientX - lastTouchX;
        const dy = e.touches[0].clientY - lastTouchY;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;

        this.yaw -= dx * 0.005;
        this.pitch -= dy * 0.005;
        this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
      } else if (e.touches.length === 2) {
        // Pinch to zoom (change speed)
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (touchStartDist > 0) {
          const scale = dist / touchStartDist;
          this.speed = Math.max(FREE_FLIGHT_SPEED_MIN,
            Math.min(FREE_FLIGHT_SPEED_MAX, this.speed * scale));
          touchStartDist = dist;
        }
      }
    }, { passive: false });
  }

  /**
   * Update camera each frame.
   */
  update(deltaTime: number): void {
    if (this.mode === 'free-flight') {
      this.updateFreeFlight(deltaTime);
    } else if (this.mode === 'focus-travel' || this.mode === 'top-view-travel') {
      this.updateFocusTravel();
    } else if (this.mode === 'smooth-journey') {
      this.updateTour();
    }

    // Subtle drift for zero-gravity feel (not during automated movements)
    if (!this.reducedMotion && this.mode === 'free-flight') {
      this.driftTime += deltaTime;
      const driftX = Math.sin(this.driftTime * CAMERA_DRIFT_FREQUENCY) * CAMERA_DRIFT_AMPLITUDE;
      const driftY = Math.cos(this.driftTime * CAMERA_DRIFT_FREQUENCY * 0.7) * CAMERA_DRIFT_AMPLITUDE;
      this.camera.position.x += driftX;
      this.camera.position.y += driftY;
    }
  }

  private updateFreeFlight(deltaTime: number): void {
    // Apply rotation
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);

    // Movement direction from keys
    const direction = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    if (this.keys.has('w') || this.keys.has('arrowup')) direction.add(forward);
    if (this.keys.has('s') || this.keys.has('arrowdown')) direction.sub(forward);
    if (this.keys.has('a') || this.keys.has('arrowleft')) direction.sub(right);
    if (this.keys.has('d') || this.keys.has('arrowright')) direction.add(right);
    if (this.keys.has('q') || this.keys.has(' ')) direction.add(up);
    if (this.keys.has('e') || this.keys.has('shift')) direction.sub(up);

    if (direction.lengthSq() > 0) {
      direction.normalize();
      this.camera.position.addScaledVector(direction, this.speed * deltaTime);
    }
  }

  /**
   * Compute the quaternion that would result from camera.lookAt, without applying it.
   * Must use a Camera (not Object3D) because cameras look along -Z, not +Z.
   */
  private computeLookAtQuat(from: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
    const dummy = new THREE.PerspectiveCamera();
    dummy.position.copy(from);
    dummy.lookAt(target);
    return dummy.quaternion.clone();
  }

  private updateFocusTravel(): void {
    if (!this.travelStart || !this.travelEnd) return;

    const elapsed = performance.now() - this.travelStartTime;
    let t = Math.min(elapsed / this.travelDuration, 1);

    // Smooth ease-in-out
    t = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Interpolate position
    this.camera.position.lerpVectors(this.travelStart, this.travelEnd, t);

    // Smoothly interpolate orientation (slerp between start and end quaternion)
    if (this.travelLookTarget) {
      // Recompute end quat based on current interpolated position looking at target
      const endQuat = this.computeLookAtQuat(this.camera.position, this.travelLookTarget);
      this.camera.quaternion.slerpQuaternions(this.travelStartQuat, endQuat, t);
    }

    if (t >= 1) {
      const wasTopView = this.mode === 'top-view-travel';
      this.mode = 'free-flight';
      // Update yaw/pitch to match current look direction
      const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = euler.y;
      this.pitch = euler.x;
      if (!wasTopView) {
        this.onTravelComplete?.();
      }
    }
  }

  /**
   * Fly the camera to frame a body at 1/9th of the screen (center of 3x3 grid).
   * Body subtends ~1/3 of viewport height at the destination.
   */
  flyTo(target: THREE.Vector3, bodyVisualRadius?: number, duration?: number): void {
    this.mode = 'focus-travel';
    this.travelStart = this.camera.position.clone();
    this.travelStartQuat.copy(this.camera.quaternion);
    this.travelLookTarget = target.clone();

    const fovRad = (this.camera.fov * Math.PI) / 180;
    const targetAngularFraction = 1 / 3;
    const halfTargetAngle = (fovRad * targetAngularFraction) / 2;

    let distance: number;
    if (bodyVisualRadius && bodyVisualRadius > 0) {
      distance = bodyVisualRadius / Math.tan(halfTargetAngle);
    } else {
      distance = 0.5;
    }

    // Approach from current direction
    const dir = this.camera.position.clone().sub(target);
    if (dir.lengthSq() < 0.001) {
      dir.set(1, 0.3, 0);
    }
    dir.normalize();

    const dest = target.clone().addScaledVector(dir, distance);
    this.travelEnd = dest;
    this.travelStartTime = performance.now();
    this.travelDuration = duration ?? FOCUS_TRAVEL_DURATION_MS;
  }

  /**
   * Fly to a top-down view centered on the Sun, high enough to see all planets.
   */
  flyToTopView(): void {
    this.mode = 'top-view-travel';
    this.travelStart = this.camera.position.clone();
    this.travelStartQuat.copy(this.camera.quaternion);

    // High above the ecliptic plane, looking down at origin
    // Slight X offset avoids gimbal lock when looking straight down
    const dest = new THREE.Vector3(1, 6000, 0);
    this.travelEnd = dest;
    this.travelLookTarget = new THREE.Vector3(0, 0, 0);
    this.travelStartTime = performance.now();
    this.travelDuration = 5000;
  }

  setOnTravelComplete(cb: (() => void) | null): void {
    this.onTravelComplete = cb;
  }

  /**
   * Start a guided tour: Sun -> Mercury -> ... -> Neptune.
   * Orbits each body, seamless transitions. ~75 seconds total.
   */
  startTour(
    waypoints: { bodyId: string; position: THREE.Vector3; visualRadius: number }[],
    getBodyPosition: (id: string) => THREE.Vector3 | null,
    onComplete?: () => void
  ): void {
    if (waypoints.length === 0) return;

    this.tourWaypoints = waypoints;
    this.getBodyPosition = getBodyPosition;
    this.onTourComplete = onComplete || null;
    this.tourIndex = 0;
    this.tourPhase = 'travel';
    this.mode = 'smooth-journey';

    // Budget: ~75s total across N bodies
    // Travel gets ~25% of time, orbit gets ~75%
    const totalMs = 75_000;
    const travelFraction = 0.25;
    const n = waypoints.length;
    this.tourTravelDuration = (totalMs * travelFraction) / n;
    this.tourOrbitDurationPerBody = (totalMs * (1 - travelFraction)) / n;

    // Capture current orientation for first seamless travel
    this.tourPrevOrbitQuat.copy(this.camera.quaternion);

    this.startTourTravel();
  }

  stopTour(): void {
    if (this.mode === 'smooth-journey') {
      this.mode = 'free-flight';
      const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = euler.y;
      this.pitch = euler.x;
    }
  }

  private startTourTravel(): void {
    const wp = this.tourWaypoints[this.tourIndex];
    const livePos = this.getBodyPosition?.(wp.bodyId);
    const target = livePos || wp.position;

    const fovRad = (this.camera.fov * Math.PI) / 180;
    const halfTargetAngle = (fovRad / 3) / 2;
    const distance = wp.visualRadius > 0
      ? wp.visualRadius / Math.tan(halfTargetAngle)
      : 0.5;

    // Approach direction: from current camera position
    const dir = this.camera.position.clone().sub(target);
    if (dir.lengthSq() < 0.001) dir.set(1, 0.3, 0);
    dir.normalize();

    const dest = target.clone().addScaledVector(dir, distance);

    this.travelStart = this.camera.position.clone();
    this.travelEnd = dest;
    this.travelLookTarget = target.clone();
    this.travelStartTime = performance.now();
    this.travelDuration = this.tourTravelDuration;

    // Store current orientation as start quat for smooth slerp
    this.travelStartQuat.copy(this.camera.quaternion);

    this.tourPhase = 'travel';
  }

  private startTourOrbit(): void {
    const wp = this.tourWaypoints[this.tourIndex];
    const livePos = this.getBodyPosition?.(wp.bodyId);
    this.tourOrbitCenter = (livePos || wp.position).clone();

    this.tourOrbitRadius = this.camera.position.distanceTo(this.tourOrbitCenter);

    const dx = this.camera.position.x - this.tourOrbitCenter.x;
    const dz = this.camera.position.z - this.tourOrbitCenter.z;
    this.tourOrbitAngle = Math.atan2(dz, dx);

    this.tourOrbitStartTime = performance.now();
    this.tourOrbitDuration = this.tourOrbitDurationPerBody;
    this.tourPhase = 'orbit';
  }

  private updateTour(): void {
    if (this.tourPhase === 'travel') {
      if (!this.travelStart || !this.travelEnd || !this.travelLookTarget) return;

      const elapsed = performance.now() - this.travelStartTime;
      let t = Math.min(elapsed / this.travelDuration, 1);
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      // Smooth position interpolation
      this.camera.position.lerpVectors(this.travelStart, this.travelEnd, t);

      // Smooth orientation: slerp from previous orientation to looking at target
      const endQuat = this.computeLookAtQuat(this.camera.position, this.travelLookTarget);
      this.camera.quaternion.slerpQuaternions(this.travelStartQuat, endQuat, t);

      if (t >= 1) {
        this.startTourOrbit();
      }
    } else if (this.tourPhase === 'orbit') {
      if (!this.tourOrbitCenter) return;

      const wp = this.tourWaypoints[this.tourIndex];
      const livePos = this.getBodyPosition?.(wp.bodyId);
      if (livePos) {
        this.tourOrbitCenter.copy(livePos);
      }

      const elapsed = performance.now() - this.tourOrbitStartTime;
      const t = Math.min(elapsed / this.tourOrbitDuration, 1);

      // Full orbit (2π) with smooth easing at start and end for seamless feel
      // Ease the angular velocity so it starts smooth and ends smooth
      const eased = t < 0.1
        ? 5 * t * t // ease in first 10%
        : t > 0.9
          ? 1 - 5 * (1 - t) * (1 - t) + (5 * 0.01) // ease out last 10%
          : t; // linear middle
      const angle = this.tourOrbitAngle + eased * Math.PI * 2;

      const camX = this.tourOrbitCenter.x + Math.cos(angle) * this.tourOrbitRadius;
      const camZ = this.tourOrbitCenter.z + Math.sin(angle) * this.tourOrbitRadius;
      const camY = this.tourOrbitCenter.y + this.tourOrbitRadius * 0.25;

      this.camera.position.set(camX, camY, camZ);
      this.camera.lookAt(this.tourOrbitCenter);

      if (t >= 1) {
        // Save the orbit end orientation for seamless next travel
        this.tourPrevOrbitQuat.copy(this.camera.quaternion);
        this.travelStartQuat.copy(this.camera.quaternion);

        this.tourIndex++;
        if (this.tourIndex >= this.tourWaypoints.length) {
          this.mode = 'free-flight';
          const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
          this.yaw = euler.y;
          this.pitch = euler.x;
          this.onTourComplete?.();
        } else {
          this.startTourTravel();
        }
      }
    }
  }

  getMode(): string {
    return this.mode;
  }

  getSpeed(): number {
    return this.speed;
  }

  getCameraPositionKm(): [number, number, number] {
    const p = this.camera.position;
    const KM = 1e6;
    return [p.x * KM, p.y * KM, p.z * KM];
  }

  getCameraPositionUnits(): [number, number, number] {
    const p = this.camera.position;
    return [p.x, p.y, p.z];
  }
}
