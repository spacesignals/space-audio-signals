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
  private mode: 'free-flight' | 'focus-travel' | 'smooth-journey' | 'top-view-travel' | 'orbit-settle' | 'orbit-idle' | 'departure-flyby' = 'free-flight';

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

  // Orbit-on-click state (orbit body before settling)
  private orbitTarget: THREE.Vector3 | null = null;
  private orbitRadius = 0;

  // Departure flyby state — cubic Bezier close-pass arc
  // P0 = orbit pos, P1 = planet center, P2 = planet pulled back (forces close pass),
  // P3 = capped distance past planet toward next body
  private departureBody: THREE.Vector3 | null = null;
  private departureP0 = new THREE.Vector3();
  private departureP1 = new THREE.Vector3();
  private departureP2 = new THREE.Vector3();
  private departureP3 = new THREE.Vector3();
  private departurePassedPlanet = false;                // true once past close-approach point
  private departurePassedQuat = new THREE.Quaternion(); // snapshot of look-at-planet at close approach
  private departurePassedElapsed = 0;                   // elapsed ms when close approach fired
  private departureStartTime = 0;
  private departureDuration = 4500;
  private pendingTarget: THREE.Vector3 | null = null;
  private pendingTargetRadius = 0;
  private orbitStartAngle = 0;
  private orbitStartTime = 0;
  private orbitDuration = 8000;
  private orbitPauseDuration = 800; // pause at arrival before orbiting
  private orbitSettlePos: THREE.Vector3 | null = null;
  private orbitStartPos = new THREE.Vector3(); // camera pos when orbit begins
  private orbitStartQuat = new THREE.Quaternion(); // camera orientation when orbit begins
  private orbitEllipticityX = 1.0;
  private orbitEllipticityY = 0.3;
  private orbitTiltX = 0;
  private orbitTiltZ = 0;

  // Continuous idle orbit after first orbit completes
  private orbitIdleDuration = 60000; // 60s per revolution
  private orbitIdleAngle = 0; // current angle in continuous orbit
  private orbitIdleStartTime = 0;
  private orbitIdleStartPos = new THREE.Vector3(); // position at idle start for blending

  // Tour state
  private tourWaypoints: { bodyId: string; position: THREE.Vector3; visualRadius: number }[] = [];
  private tourIndex = 0;
  private tourPhase: 'travel' | 'orbit' | 'departure' = 'travel';
  // Tour departure: cubic Bezier close-pass (same shape as click-flyby)
  private tourDepartureP0 = new THREE.Vector3();
  private tourDepartureP1 = new THREE.Vector3();
  private tourDepartureP2 = new THREE.Vector3();
  private tourDepartureP3 = new THREE.Vector3();
  private tourDepartureFlyFwdQuat = new THREE.Quaternion(); // look toward next destination (last-waypoint case)
  private tourDeparturePassedPlanet = false;
  private tourDeparturePassedQuat = new THREE.Quaternion();
  private tourDeparturePassedElapsed = 0;
  private tourDepartureStartTime = 0;
  private tourOrbitAngle = 0;
  private tourOrbitCenter: THREE.Vector3 | null = null;
  private tourOrbitRadius = 0;
  private tourOrbitStartTime = 0;
  private tourOrbitDuration = 0;
  private tourTravelDuration = 2000;
  private tourOrbitDurationPerBody = 4500;
  private tourPrevOrbitQuat = new THREE.Quaternion(); // for seamless orbit→travel blend
  private tourOrbitStartPos = new THREE.Vector3(); // camera pos when orbit begins
  private onTourComplete: (() => void) | null = null;
  private getBodyPosition: ((id: string) => THREE.Vector3 | null) | null = null;

  // Drift (zero-gravity feel) — offset only, never mutates camera.position
  private driftTime = 0;
  private driftOffset = new THREE.Vector3();
  private driftApplied = false;
  private reducedMotion = false;

  // Pre-allocated reusable vectors for updateFreeFlight (avoid GC pressure)
  private _direction = new THREE.Vector3();
  private _forward = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _euler = new THREE.Euler();
  private _localUp = new THREE.Vector3();
  private _turnQuat = new THREE.Quaternion();
  private _baseQuat = new THREE.Quaternion();
  private _arrowEuler = new THREE.Euler();

  // Pre-allocated for computeLookAtQuat — avoids creating a new camera every frame
  private _dummyCamera = new THREE.PerspectiveCamera();
  private _lookAtQuat = new THREE.Quaternion();


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

      // Any key stops tour, travel, orbit, or departure flyby
      if (this.mode === 'smooth-journey') {
        this.stopTour();
      } else if (this.mode === 'focus-travel' || this.mode === 'top-view-travel' || this.mode === 'orbit-settle' || this.mode === 'orbit-idle' || this.mode === 'departure-flyby') {
        this.mode = 'free-flight';
        const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.yaw = euler.y;
        this.pitch = euler.x;
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
      } else if (this.mode === 'focus-travel' || this.mode === 'top-view-travel' || this.mode === 'orbit-settle' || this.mode === 'orbit-idle' || this.mode === 'departure-flyby') {
        this.mode = 'free-flight';
        const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.yaw = euler.y;
        this.pitch = euler.x;
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
    } else if (this.mode === 'orbit-settle') {
      this.updateOrbitSettle();
    } else if (this.mode === 'orbit-idle') {
      this.updateOrbitIdle();
    } else if (this.mode === 'departure-flyby') {
      this.updateDepartureFlyby();
    }

    // Compute drift offset (oscillating, never accumulated)
    if (!this.reducedMotion && (this.mode === 'free-flight' || this.mode === 'orbit-settle' || this.mode === 'orbit-idle')) {
      this.driftTime += deltaTime;
      this.driftOffset.set(
        Math.sin(this.driftTime * CAMERA_DRIFT_FREQUENCY) * CAMERA_DRIFT_AMPLITUDE,
        Math.cos(this.driftTime * CAMERA_DRIFT_FREQUENCY * 0.7) * CAMERA_DRIFT_AMPLITUDE,
        0
      );
    } else {
      this.driftOffset.set(0, 0, 0);
    }
  }

  private updateFreeFlight(deltaTime: number): void {
    // Arrow key look: rotate around camera-local Y so "left" is always left relative to view
    let arrowTurn = 0;
    if (this.keys.has('arrowleft')) arrowTurn += 1.5 * deltaTime;
    if (this.keys.has('arrowright')) arrowTurn -= 1.5 * deltaTime;
    if (arrowTurn !== 0) {
      this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this._baseQuat.setFromEuler(this._euler);
      this._localUp.set(0, 1, 0).applyQuaternion(this._baseQuat);
      this._turnQuat.setFromAxisAngle(this._localUp, arrowTurn);
      this._baseQuat.premultiply(this._turnQuat);
      this._arrowEuler.setFromQuaternion(this._baseQuat, 'YXZ');
      this.yaw = this._arrowEuler.y;
      this.pitch = this._arrowEuler.x;
    }

    // Apply rotation (reuse euler)
    this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);

    // Movement direction from keys (reuse pre-allocated vectors)
    this._direction.set(0, 0, 0);
    this._forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    if (this.keys.has('w') || this.keys.has('arrowup')) this._direction.add(this._forward);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this._direction.sub(this._forward);
    if (this.keys.has('a')) this._direction.sub(this._right);
    if (this.keys.has('d')) this._direction.add(this._right);
    if (this.keys.has('q') || this.keys.has(' ')) this._direction.y += 1;
    if (this.keys.has('e') || this.keys.has('shift')) this._direction.y -= 1;

    if (this._direction.lengthSq() > 0) {
      this._direction.normalize();
      this.camera.position.addScaledVector(this._direction, this.speed * deltaTime);
    }
  }

  /**
   * Depart from the current orbit body via a cubic Bezier close-pass.
   * Geometry forces the camera to actually pass within ~0.2r of the planet
   * (vs the old quadratic where min distance was ~0.8r → no visible swell).
   * Hands off to flyTo at t=1 once camera is past the planet on the toNext side.
   */
  private startDepartureFlyby(pendingTarget: THREE.Vector3, pendingRadius: number): void {
    if (!this.orbitTarget) return;

    this.mode = 'departure-flyby';
    this.departureBody = this.orbitTarget.clone();
    this.departureStartTime = performance.now();
    this.departurePassedPlanet = false;
    this.pendingTarget = pendingTarget.clone();
    this.pendingTargetRadius = pendingRadius;

    const r = this.orbitRadius;
    const toNext = new THREE.Vector3()
      .subVectors(pendingTarget, this.orbitTarget)
      .normalize();

    // Cap arc extent so we don't overshoot the destination (matters for Sun → Mercury etc.)
    const distToNext = pendingTarget.distanceTo(this.orbitTarget);
    const p3Dist = Math.min(2 * r, 0.5 * distToNext);
    const p2Pull = Math.min(0.3 * r, 0.15 * distToNext);

    this.departureP0.copy(this.camera.position);
    this.departureP1.copy(this.orbitTarget);                                  // tangent at t=0 → toward planet
    this.departureP2.copy(this.orbitTarget).addScaledVector(toNext, -p2Pull); // pulls curve through close-pass
    this.departureP3.copy(this.orbitTarget).addScaledVector(toNext, p3Dist);  // tangent at t=1 → toward destination
  }

  /**
   * Cubic Bezier evaluation: planet swells (~5x apparent size at close pass),
   * camera tracks it, then pans to the destination once past.
   */
  private updateDepartureFlyby(): void {
    if (!this.departureBody || !this.pendingTarget) return;

    const elapsed = performance.now() - this.departureStartTime;
    const t = Math.min(elapsed / this.departureDuration, 1);

    // Cubic Bezier: B(t) = (1-t)³P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
    const om = 1 - t;
    const b0 = om * om * om;
    const b1 = 3 * om * om * t;
    const b2 = 3 * om * t * t;
    const b3 = t * t * t;
    this.camera.position.set(
      b0 * this.departureP0.x + b1 * this.departureP1.x + b2 * this.departureP2.x + b3 * this.departureP3.x,
      b0 * this.departureP0.y + b1 * this.departureP1.y + b2 * this.departureP2.y + b3 * this.departureP3.y,
      b0 * this.departureP0.z + b1 * this.departureP1.z + b2 * this.departureP2.z + b3 * this.departureP3.z
    );

    // Phase 1 (t < 0.6, ≈ 2.7s): camera tracks planet — it approaches, swells, sweeps past.
    // Phase 2 (t >= 0.6): slerp from look-at-planet snapshot to look-at-destination over 1.5s.
    if (!this.departurePassedPlanet && t >= 0.6) {
      this.departurePassedPlanet = true;
      this.departurePassedQuat.copy(this.computeLookAtQuat(this.camera.position, this.departureBody));
      this.departurePassedElapsed = elapsed;
    }

    if (!this.departurePassedPlanet) {
      this.camera.quaternion.copy(this.computeLookAtQuat(this.camera.position, this.departureBody));
    } else {
      const postFraction = Math.min(1, (elapsed - this.departurePassedElapsed) / 1500);
      const sb = postFraction * postFraction * (3 - 2 * postFraction);
      const targetQuat = this.computeLookAtQuat(this.camera.position, this.pendingTarget);
      this.camera.quaternion.slerpQuaternions(this.departurePassedQuat, targetQuat, sb);
    }

    if (t >= 1) {
      const target = this.pendingTarget;
      const radius = this.pendingTargetRadius;
      this.pendingTarget = null;
      this.departureBody = null;
      this.flyTo(target, radius);
    }
  }

  /**
   * Compute the quaternion that would result from camera.lookAt, without applying it.
   * Must use a Camera (not Object3D) because cameras look along -Z, not +Z.
   */
  private computeLookAtQuat(from: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
    this._dummyCamera.position.copy(from);
    this._dummyCamera.lookAt(target);
    this._lookAtQuat.copy(this._dummyCamera.quaternion);
    return this._lookAtQuat;
  }

  private updateFocusTravel(): void {
    if (!this.travelStart || !this.travelEnd) return;

    const elapsed = performance.now() - this.travelStartTime;
    let t = Math.min(elapsed / this.travelDuration, 1);

    // Quadratic ease-in-out — starts faster than cubic, avoids perceived hover
    t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

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
      if (!wasTopView && this.orbitTarget) {
        // Snap to exact lookAt so orbit-settle starts from the same orientation it computes
        const exactQuat = this.computeLookAtQuat(this.camera.position, this.orbitTarget);
        this.camera.quaternion.copy(exactQuat);
        // Transition to orbit-settle: do one elliptical orbit before settling
        this.mode = 'orbit-settle';
        this.orbitStartTime = performance.now();
        this.orbitStartPos.copy(this.camera.position);
        this.orbitStartQuat.copy(this.camera.quaternion);
        // Start angle from current position relative to target
        const dx = this.camera.position.x - this.orbitTarget.x;
        const dz = this.camera.position.z - this.orbitTarget.z;
        this.orbitStartAngle = Math.atan2(dz, dx);
      } else {
        this.mode = 'free-flight';
        const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.yaw = euler.y;
        this.pitch = euler.x;
      }
    }
  }

  /**
   * Fly the camera to a body, orbit it once with a dynamic elliptical path, then settle.
   * Body subtends ~1/3 of viewport height at the destination.
   */
  flyTo(target: THREE.Vector3, bodyVisualRadius?: number, duration?: number): void {
    // If currently orbiting a different body, do a slow departure flyby first
    if (
      (this.mode === 'orbit-idle' || this.mode === 'orbit-settle') &&
      this.orbitTarget &&
      this.orbitTarget.distanceTo(target) > 0.01
    ) {
      this.startDepartureFlyby(target, bodyVisualRadius ?? 0);
      return;
    }

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

    // Set up orbit-after-arrival
    this.orbitTarget = target.clone();

    this.orbitRadius = distance;
    this.orbitSettlePos = dest.clone();
    // Randomize orbit shape for variety
    this.orbitEllipticityX = 0.8 + Math.random() * 0.4;
    this.orbitEllipticityY = 0.15 + Math.random() * 0.25;
    this.orbitTiltX = (Math.random() - 0.5) * 0.4;
    this.orbitTiltZ = (Math.random() - 0.5) * 0.3;
  }

  /**
   * Update the orbit-settle phase: elliptical orbit around body then ease to final position.
   */
  private updateOrbitSettle(): void {
    if (!this.orbitTarget || !this.orbitSettlePos) return;

    const rawElapsed = performance.now() - this.orbitStartTime;

    // Pause at arrival position before orbiting begins
    if (rawElapsed < this.orbitPauseDuration) {
      // Hold position and orientation steady
      this.camera.position.copy(this.orbitStartPos);
      this.camera.quaternion.copy(this.orbitStartQuat);
      return;
    }

    const elapsed = rawElapsed - this.orbitPauseDuration;
    const t = Math.min(elapsed / this.orbitDuration, 1);

    // Very gentle ease-in, smooth ease-out: zero 1st+2nd derivatives at start
    // Uses quintic smootherstep for imperceptible orbit start
    const eased = t * t * t * (t * (t * 6 - 15) + 10);

    // Orbit as a displacement from the start position:
    // At t=0 displacement is (0,0,0) — no jump.
    // At t=1 displacement returns to (0,0,0) — full circle.
    const angle = eased * Math.PI * 2;
    const r = this.orbitRadius;

    // Displacement from circular orbit baseline (cos(0)=1 at start, returns to 1 at end)
    const dOrbitX = (Math.cos(this.orbitStartAngle + angle) - Math.cos(this.orbitStartAngle)) * r * this.orbitEllipticityX;
    const dOrbitZ = (Math.sin(this.orbitStartAngle + angle) - Math.sin(this.orbitStartAngle)) * r;
    const dOrbitY = Math.sin(angle * 2) * r * this.orbitEllipticityY; // Y oscillation (zero at start and end)

    // Apply tilt to displacement
    const dx = dOrbitX * Math.cos(this.orbitTiltZ) - dOrbitY * Math.sin(this.orbitTiltZ);
    const dy = dOrbitX * Math.sin(this.orbitTiltX) + dOrbitY * Math.cos(this.orbitTiltX);
    const dz = dOrbitZ;

    let px = this.orbitStartPos.x + dx;
    let py = this.orbitStartPos.y + dy;
    let pz = this.orbitStartPos.z + dz;

    // Blend toward settle position in last 20%
    if (t > 0.8) {
      const blend = (t - 0.8) / 0.2;
      const sb = blend * blend * (3 - 2 * blend);
      px += (this.orbitSettlePos.x - px) * sb;
      py += (this.orbitSettlePos.y - py) * sb;
      pz += (this.orbitSettlePos.z - pz) * sb;
    }

    this.camera.position.set(px, py, pz);

    // Orientation: slerp from the exact saved start quaternion into lookAt
    // Use a long blend (25%) so the transition is imperceptible
    const lookAtQuat = this.computeLookAtQuat(this.camera.position, this.orbitTarget);
    if (t < 0.25) {
      const blend = t / 0.25;
      const sb = blend * blend * (3 - 2 * blend);
      this.camera.quaternion.slerpQuaternions(this.orbitStartQuat, lookAtQuat, sb);
    } else {
      this.camera.quaternion.copy(lookAtQuat);
    }

    if (t >= 1) {
      // Transition seamlessly into continuous idle orbit
      // Compute angle from actual camera position to ensure no jump
      const cdx = this.camera.position.x - this.orbitTarget.x;
      const cdz = this.camera.position.z - this.orbitTarget.z;
      this.orbitIdleAngle = Math.atan2(cdz, cdx);
      this.orbitIdleStartPos.copy(this.camera.position);
      this.mode = 'orbit-idle';
      this.orbitIdleStartTime = performance.now();
      this.onTravelComplete?.();
    }
  }

  /**
   * Continuous slow orbit around body. Interrupted by any input.
   * Seamless from orbit-settle: starts at same position/angle.
   */
  private updateOrbitIdle(): void {
    if (!this.orbitTarget) return;

    const elapsed = performance.now() - this.orbitIdleStartTime;
    const angle = this.orbitIdleAngle + (elapsed / this.orbitIdleDuration) * Math.PI * 2;

    const r = this.orbitRadius;
    const cx = this.orbitTarget.x;
    const cy = this.orbitTarget.y;
    const cz = this.orbitTarget.z;

    // Same elliptical shape as the initial orbit for consistency
    const orbitX = Math.cos(angle) * r * this.orbitEllipticityX;
    const orbitZ = Math.sin(angle) * r;
    const orbitY = Math.sin(angle * 2) * r * this.orbitEllipticityY;

    let px = cx + orbitX * Math.cos(this.orbitTiltZ) - orbitY * Math.sin(this.orbitTiltZ);
    let py = cy + orbitX * Math.sin(this.orbitTiltX) + orbitY * Math.cos(this.orbitTiltX);
    let pz = cz + orbitZ;

    // Blend from actual start position over first 15% of first revolution
    const blendT = elapsed / this.orbitIdleDuration;
    if (blendT < 0.15) {
      const sb = (blendT / 0.15);
      const smooth = sb * sb * (3 - 2 * sb);
      px = this.orbitIdleStartPos.x + (px - this.orbitIdleStartPos.x) * smooth;
      py = this.orbitIdleStartPos.y + (py - this.orbitIdleStartPos.y) * smooth;
      pz = this.orbitIdleStartPos.z + (pz - this.orbitIdleStartPos.z) * smooth;
    }

    this.camera.position.set(px, py, pz);
    this.camera.lookAt(this.orbitTarget);
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

    this.tourTravelDuration = 3000; // ~3s travel per body (same as before)
    this.tourOrbitDurationPerBody = 9000; // ~9s orbit per body (doubled)

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

  // Tour orbit elliptical params (randomized per body)
  private tourEllipticityX = 1.0;
  private tourEllipticityY = 0.3;
  private tourTiltX = 0;
  private tourTiltZ = 0;

  private startTourOrbit(): void {
    const wp = this.tourWaypoints[this.tourIndex];
    const livePos = this.getBodyPosition?.(wp.bodyId);
    this.tourOrbitCenter = (livePos || wp.position).clone();

    this.tourOrbitRadius = this.camera.position.distanceTo(this.tourOrbitCenter);

    const dx = this.camera.position.x - this.tourOrbitCenter.x;
    const dz = this.camera.position.z - this.tourOrbitCenter.z;
    this.tourOrbitAngle = Math.atan2(dz, dx);

    // Randomize elliptical orbit shape per body
    this.tourEllipticityX = 0.7 + Math.random() * 0.6;
    this.tourEllipticityY = 0.15 + Math.random() * 0.3;
    this.tourTiltX = (Math.random() - 0.5) * 0.5;
    this.tourTiltZ = (Math.random() - 0.5) * 0.4;

    // Capture state at orbit start for smooth blend-in
    this.tourPrevOrbitQuat.copy(this.camera.quaternion);
    this.tourOrbitStartPos.copy(this.camera.position);

    this.tourOrbitStartTime = performance.now();
    this.tourOrbitDuration = this.tourOrbitDurationPerBody;
    this.tourPhase = 'orbit';
  }

  private startTourDeparture(): void {
    const wp = this.tourWaypoints[this.tourIndex];
    const nextWp = this.tourWaypoints[this.tourIndex + 1];
    const currentBodyPos = (this.getBodyPosition?.(wp.bodyId) || wp.position).clone();

    this.tourDepartureStartTime = performance.now();
    this.tourDeparturePassedPlanet = false;

    const r = this.tourOrbitRadius;

    if (!nextWp) {
      // Last waypoint: fly radially out, no close-pass needed.
      const radialOut = new THREE.Vector3()
        .subVectors(this.camera.position, currentBodyPos)
        .normalize();
      // Degenerate cubic: P0 = start, P1=P2=start+3r, P3 = start+15r (all collinear → straight line)
      this.tourDepartureP0.copy(this.camera.position);
      this.tourDepartureP1.copy(this.camera.position).addScaledVector(radialOut, r * 5);
      this.tourDepartureP2.copy(this.camera.position).addScaledVector(radialOut, r * 10);
      this.tourDepartureP3.copy(this.camera.position).addScaledVector(radialOut, r * 15);
      this.tourDepartureFlyFwdQuat.copy(
        this.computeLookAtQuat(this.tourDepartureP0, this.tourDepartureP3)
      );
      this.tourPhase = 'departure';
      return;
    }

    const nextPos = (this.getBodyPosition?.(nextWp.bodyId) || nextWp.position).clone();
    const toNext = new THREE.Vector3().subVectors(nextPos, currentBodyPos).normalize();

    // Cubic Bezier close-pass — same shape as click-flyby
    const distToNext = nextPos.distanceTo(currentBodyPos);
    const p3Dist = Math.min(2 * r, 0.5 * distToNext);
    const p2Pull = Math.min(0.3 * r, 0.15 * distToNext);

    this.tourDepartureP0.copy(this.camera.position);
    this.tourDepartureP1.copy(currentBodyPos);
    this.tourDepartureP2.copy(currentBodyPos).addScaledVector(toNext, -p2Pull);
    this.tourDepartureP3.copy(currentBodyPos).addScaledVector(toNext, p3Dist);

    this.tourPhase = 'departure';
  }

  private updateTour(): void {
    if (this.tourPhase === 'travel') {
      if (!this.travelStart || !this.travelEnd || !this.travelLookTarget) return;

      // Live-track the target body's position during travel (planets move)
      const wp = this.tourWaypoints[this.tourIndex];
      const livePos = this.getBodyPosition?.(wp.bodyId);
      if (livePos) {
        // Recompute destination: same approach direction, same distance, updated center
        const fovRad = (this.camera.fov * Math.PI) / 180;
        const halfTargetAngle = (fovRad / 3) / 2;
        const distance = wp.visualRadius > 0
          ? wp.visualRadius / Math.tan(halfTargetAngle)
          : 0.5;
        const dir = this.travelStart.clone().sub(livePos);
        if (dir.lengthSq() < 0.001) dir.set(1, 0.3, 0);
        dir.normalize();
        this.travelEnd.copy(livePos).addScaledVector(dir, distance);
        this.travelLookTarget.copy(livePos);
      }

      const elapsed = performance.now() - this.travelStartTime;
      const rawT = Math.min(elapsed / this.travelDuration, 1);
      let t = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

      // Smooth position interpolation
      this.camera.position.lerpVectors(this.travelStart, this.travelEnd, t);

      // Fast orientation snap: pan completes in first 20% of travel time (~600ms at default 3s)
      // This prevents Venus appearing to travel backwards while the camera slowly turns mid-flight
      const panT = Math.min(rawT / 0.20, 1);
      const panEased = panT < 0.5 ? 2 * panT * panT : 1 - Math.pow(-2 * panT + 2, 2) / 2;
      const endQuat = this.computeLookAtQuat(this.camera.position, this.travelLookTarget);
      this.camera.quaternion.slerpQuaternions(this.travelStartQuat, endQuat, panEased);

      if (t >= 1) {
        this.startTourOrbit();
      }
    } else if (this.tourPhase === 'departure') {
      const elapsed = performance.now() - this.tourDepartureStartTime;
      const t = Math.min(elapsed / this.departureDuration, 1);

      // Cubic Bezier — same form as click-flyby
      const om = 1 - t;
      const b0 = om * om * om;
      const b1 = 3 * om * om * t;
      const b2 = 3 * om * t * t;
      const b3 = t * t * t;
      this.camera.position.set(
        b0 * this.tourDepartureP0.x + b1 * this.tourDepartureP1.x + b2 * this.tourDepartureP2.x + b3 * this.tourDepartureP3.x,
        b0 * this.tourDepartureP0.y + b1 * this.tourDepartureP1.y + b2 * this.tourDepartureP2.y + b3 * this.tourDepartureP3.y,
        b0 * this.tourDepartureP0.z + b1 * this.tourDepartureP1.z + b2 * this.tourDepartureP2.z + b3 * this.tourDepartureP3.z
      );

      const wp = this.tourWaypoints[this.tourIndex];
      const nextWp = this.tourWaypoints[this.tourIndex + 1];
      const tourBodyPos = this.getBodyPosition?.(wp.bodyId) || wp.position;

      // Track planet until t=0.6, then slerp toward next-waypoint look (or fixed forward for last waypoint)
      if (!this.tourDeparturePassedPlanet && t >= 0.6) {
        this.tourDeparturePassedPlanet = true;
        this.tourDeparturePassedQuat.copy(this.computeLookAtQuat(this.camera.position, tourBodyPos));
        this.tourDeparturePassedElapsed = elapsed;
      }
      if (!this.tourDeparturePassedPlanet) {
        this.camera.quaternion.copy(this.computeLookAtQuat(this.camera.position, tourBodyPos));
      } else {
        const tourPostFraction = Math.min(1, (elapsed - this.tourDeparturePassedElapsed) / 1500);
        const sb = tourPostFraction * tourPostFraction * (3 - 2 * tourPostFraction);
        if (nextWp) {
          const nextPos = this.getBodyPosition?.(nextWp.bodyId) || nextWp.position;
          const targetQuat = this.computeLookAtQuat(this.camera.position, nextPos);
          this.camera.quaternion.slerpQuaternions(this.tourDeparturePassedQuat, targetQuat, sb);
        } else {
          this.camera.quaternion.slerpQuaternions(this.tourDeparturePassedQuat, this.tourDepartureFlyFwdQuat, sb);
        }
      }

      if (t >= 1) {
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
    } else if (this.tourPhase === 'orbit') {
      if (!this.tourOrbitCenter) return;

      const wp = this.tourWaypoints[this.tourIndex];
      const livePos = this.getBodyPosition?.(wp.bodyId);
      if (livePos) {
        this.tourOrbitCenter.copy(livePos);
      }

      const elapsed = performance.now() - this.tourOrbitStartTime;
      const t = Math.min(elapsed / this.tourOrbitDuration, 1);

      // Full orbit (2π) with smoothstep easing for seamless start/end
      const eased = t * t * (3 - 2 * t);
      const angle = eased * Math.PI * 2;

      // Displacement-from-start orbit: at t=0 displacement is zero (no jump)
      const r = this.tourOrbitRadius;
      const dOrbitX = (Math.cos(this.tourOrbitAngle + angle) - Math.cos(this.tourOrbitAngle)) * r * this.tourEllipticityX;
      const dOrbitZ = (Math.sin(this.tourOrbitAngle + angle) - Math.sin(this.tourOrbitAngle)) * r;
      const dOrbitY = Math.sin(angle * 2) * r * this.tourEllipticityY;

      const dx = dOrbitX * Math.cos(this.tourTiltZ) - dOrbitY * Math.sin(this.tourTiltZ);
      const dz = dOrbitZ;
      const dy = dOrbitX * Math.sin(this.tourTiltX) + dOrbitY * Math.cos(this.tourTiltX);

      const camX = this.tourOrbitStartPos.x + dx;
      const camY = this.tourOrbitStartPos.y + dy;
      const camZ = this.tourOrbitStartPos.z + dz;

      this.camera.position.set(camX, camY, camZ);

      // Compute target lookAt quaternion from updated position
      const targetQuat = this.computeLookAtQuat(this.camera.position, this.tourOrbitCenter);

      // Blend orientation from travel-end into orbit lookAt over first 15%
      if (t < 0.15) {
        const blend = t / 0.15;
        const smoothBlend = blend * blend * (3 - 2 * blend);
        this.camera.quaternion.slerpQuaternions(this.tourPrevOrbitQuat, targetQuat, smoothBlend);
      } else {
        this.camera.quaternion.copy(targetQuat);
      }

      if (t >= 1) {
        this.tourPrevOrbitQuat.copy(this.camera.quaternion);
        this.travelStartQuat.copy(this.camera.quaternion);
        this.startTourDeparture();
      }
    }
  }

  getMode(): string {
    return this.mode;
  }

  getSpeed(): number {
    return this.speed;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(FREE_FLIGHT_SPEED_MIN, Math.min(FREE_FLIGHT_SPEED_MAX, speed));
  }

  /**
   * Apply drift offset to camera position before rendering.
   * Must call removeDrift() after render to restore clean position.
   */
  applyDrift(): void {
    if (!this.driftApplied) {
      this.camera.position.add(this.driftOffset);
      this.driftApplied = true;
    }
  }

  /**
   * Remove drift offset from camera position after rendering.
   */
  removeDrift(): void {
    if (this.driftApplied) {
      this.camera.position.sub(this.driftOffset);
      this.driftApplied = false;
    }
  }

  getCameraPositionKm(): [number, number, number] {
    const p = this.camera.position;
    const KM = 1e6;
    return [p.x * KM, p.y * KM, p.z * KM];
  }

  /** Returns the clean (non-drifted) camera position in Three.js units. */
  getCameraPositionUnits(): [number, number, number] {
    const p = this.camera.position;
    return [p.x, p.y, p.z];
  }
}
