import * as THREE from 'three';
import { SolarSystem } from './engine/SolarSystem';
import { OrbitLines } from './engine/OrbitLines';
import { BeltField } from './engine/BeltField';
import { Ephemeris } from './engine/Ephemeris';
import { SimClock } from './engine/SimClock';
import { Navigation } from './engine/Navigation';
import { PostProcessing } from './engine/PostProcessing';
import { AudioEngine } from './audio/AudioEngine';
import { HUD } from './ui/HUD.tsx';
import { Labels } from './ui/Labels';
import { loadSettings } from './ui/settings';
import { PerformanceMonitor } from './engine/PerformanceMonitor';
import { AdaptiveResolution } from './engine/AdaptiveResolution';
import { BODIES, MOON_ORBITS } from './data/bodies';
import { CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR, KM_PER_UNIT } from './data/constants';
import type { BodyDistance } from './types';

/*
 * GalaxyMusic — Main Application
 *
 *   ┌─────────┐     ┌──────────┐     ┌────────────┐
 *   │Ephemeris│────▶│SolarSystem│────▶│  Renderer  │
 *   └─────────┘     └──────────┘     └────────────┘
 *        │                                   │
 *        ▼                                   ▼
 *   ┌──────────┐     ┌──────────┐     ┌────────────┐
 *   │Navigation│────▶│AudioEngine│    │PostProcessing│
 *   └──────────┘     └──────────┘     └────────────┘
 *        │                │
 *        └───────┬────────┘
 *                ▼
 *            ┌──────┐
 *            │ HUD  │
 *            └──────┘
 */

class App {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private solarSystem: SolarSystem;
  private orbitLines: OrbitLines;
  private beltField: BeltField;
  private ephemeris: Ephemeris;
  private simClock = new SimClock();
  private navigation: Navigation;
  private postProcessing: PostProcessing;
  private audioEngine: AudioEngine;
  private hud: HUD;
  private labels: Labels;
  private perfMonitor: PerformanceMonitor;

  private clock = new THREE.Clock();
  private running = false;
  private adaptiveRes: AdaptiveResolution;
  private _audioFwd = new THREE.Vector3();
  private _audioUp = new THREE.Vector3();
  private lastHudUpdate = 0;

  private constructor() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);

    // Camera — start near Earth's orbit looking toward Sun
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR
    );
    this.camera.position.set(150, 30, 0);
    this.camera.lookAt(0, 0, 0); // Face the Sun on startup

    // Systems
    this.ephemeris = new Ephemeris();
    this.solarSystem = new SolarSystem(
      this.scene,
      this.renderer.capabilities.getMaxAnisotropy(),
      (texture) => this.renderer.initTexture(texture)
    );
    this.orbitLines = new OrbitLines(this.scene);
    // Belts: fewer points on coarse-pointer (mobile/tablet) devices
    this.beltField = new BeltField(this.scene, window.matchMedia('(pointer: coarse)').matches);
    this.navigation = new Navigation(this.camera, this.renderer.domElement);
    this.postProcessing = new PostProcessing(this.renderer, this.scene, this.camera);
    this.audioEngine = new AudioEngine();
    this.hud = new HUD();
    this.labels = new Labels((bodyId) => this.focusBody(bodyId));
    this.perfMonitor = new PerformanceMonitor();

    // Dynamic render-scale: steps resolution down on weak GPUs (phones), back up with headroom
    this.adaptiveRes = new AdaptiveResolution(
      Math.min(window.devicePixelRatio, 2),
      (pixelRatio) => {
        this.renderer.setPixelRatio(pixelRatio);
        this.postProcessing.setPixelRatio(pixelRatio, window.innerWidth, window.innerHeight);
      }
    );
  }

  static async create(): Promise<App> {
    const loader = document.getElementById('loader');
    const loaderBar = document.getElementById('loader-bar');
    const setProgress = (pct: number) => {
      if (loaderBar) loaderBar.style.width = `${pct}%`;
    };

    // Early progress: renderer + scene setup
    setProgress(5);
    await new Promise(r => setTimeout(r, 0));

    const app = new App();

    // Scene + systems initialized
    setProgress(15);
    await new Promise(r => setTimeout(r, 0));

    // Init bodies with progress mapped to 15-100%
    await app.solarSystem.initBodies(BODIES, (pct) => {
      setProgress(15 + pct * 0.85);
    });
    if (loaderBar) loaderBar.style.width = '100%';
    // Brief pause at 100% then fade out
    await new Promise(r => setTimeout(r, 300));
    if (loader) {
      loader.style.transition = 'opacity 0.5s';
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 500);
    }
    // Orbit lines: moons/asteroids are cheap circles (sync); planet paths are
    // sampled from astronomy-engine in the background (chunked, non-blocking).
    app.orbitLines.initMoonAndAsteroidOrbits();
    void app.orbitLines.initPlanetOrbits();
    app.labels.init(BODIES);
    app.hud.initBodyList(BODIES);
    app.setup();
    return app;
  }

  private setup(): void {
    // Planet focus tour: Sun -> planets in order (skips moons/asteroids)
    const tourOrder = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

    const waypointsFor = (ids: string[]) => ids.map(id => ({
      bodyId: id,
      position: this.solarSystem.getBodyPosition(id) || new THREE.Vector3(),
      visualRadius: this.solarSystem.getBodyVisualRadius(id) || 0.1,
    }));
    const liveBodyPosition = (id: string) => this.solarSystem.getBodyPosition(id);

    // Ambient moon tour: every moon, ordered sunward-out — by the parent
    // planet's live distance from the Sun, then inner-to-outer within each system.
    const moonTourIds = (): string[] => {
      const parentDist = new Map<string, number>();
      for (const b of BODIES) {
        if (b.type !== 'moon' || !b.parentId || parentDist.has(b.parentId)) continue;
        parentDist.set(b.parentId, this.solarSystem.getBodyPosition(b.parentId)?.length() ?? Infinity);
      }
      return BODIES
        .filter(b => b.type === 'moon' && b.parentId)
        .sort((a, b) =>
          (parentDist.get(a.parentId!)! - parentDist.get(b.parentId!)!) ||
          ((MOON_ORBITS[a.id]?.semiMajorAxisKm ?? 0) - (MOON_ORBITS[b.id]?.semiMajorAxisKm ?? 0))
        )
        .map(b => b.id);
    };

    // Apply persisted settings (every layer/mod has a toggle; all survive reload)
    const settings = loadSettings();
    this.labels.setVisible(settings.labels);
    this.orbitLines.setVisible(settings.orbitLines);
    this.solarSystem.setStarfieldVisible(settings.starField);
    this.solarSystem.setFloodLighting(settings.floodLighting);
    this.beltField.setVisible(settings.belts);
    this.postProcessing.setBloomStrength(settings.bloom / 100);

    // Background audio toggle (default: enabled — audio continues when tab hidden)
    let backgroundAudioEnabled = settings.backgroundAudio;

    this.hud.setCallbacks({
      onBodySelect: (bodyId) => this.focusBody(bodyId),
      onStart: () => {
        void this.audioEngine.init().then(() => {
          this.audioEngine.setMasterVolume(loadSettings().volume / 100);
        });
        this.running = true;
        // Deep link (#saturn): fly there from the spawn view once started
        this.applyHashTarget();
      },
      onTour: () => {
        this.navigation.startTour(waypointsFor(tourOrder), liveBodyPosition);
      },
      onMoonTour: () => {
        this.navigation.startTour(waypointsFor(moonTourIds()), liveBodyPosition);
      },
      onTopView: () => this.navigation.flyToTopView(),
      onTimeStep: (dir) => this.simClock.stepRate(dir),
      onTimeLive: () => this.simClock.goLive(),
      onToggleLabels: (visible) => this.labels.setVisible(visible),
      onToggleOrbits: (visible) => this.orbitLines.setVisible(visible),
      onToggleStarfield: (visible) => this.solarSystem.setStarfieldVisible(visible),
      onToggleFlood: (flood) => this.solarSystem.setFloodLighting(flood),
      onToggleBelts: (visible) => this.beltField.setVisible(visible),
      onToggleDebug: () => this.perfMonitor.toggle(),
      onVolumeChange: (volume) => this.audioEngine.setMasterVolume(volume),
      onBloomStrengthChange: (strength) => this.postProcessing.setBloomStrength(strength),
      onSpeedChange: (speed) => this.navigation.setSpeed(speed),
      onToggleBackgroundAudio: (enabled) => {
        backgroundAudioEnabled = enabled;
      },
    });
    // 1-9 speed presets flash the HUD speed readout
    this.navigation.setOnSpeedPreset(() => this.hud.flashSpeed());

    // Shareable deep links: #saturn focuses Saturn; hash updates on focus
    window.addEventListener('hashchange', () => {
      if (this.running) this.applyHashTarget();
    });

    document.addEventListener('visibilitychange', () => {
      if (!this.running) return;
      if (document.hidden && !backgroundAudioEnabled) {
        this.audioEngine.suspend();
      } else if (!document.hidden) {
        this.audioEngine.resume();
      }
    });

    // Resize
    window.addEventListener('resize', () => this.onResize());

    // Start render loop (audio waits for user gesture via start overlay)
    this.animate();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.perfMonitor.beginFrame();

    const deltaTime = this.clock.getDelta();
    const now = performance.now();

    this.adaptiveRes.tick(deltaTime);

    // Advance simulation time (pinned to wall clock while live)
    this.simClock.tick(deltaTime);

    // Update ephemeris (astronomy bodies at 1Hz, or per-frame while scrubbing)
    const positions = this.ephemeris.update(now, this.simClock.getSimMs());

    // Update 3D scene
    this.solarSystem.updatePositions(positions);
    this.solarSystem.updateRotations(deltaTime);
    this.orbitLines.update(this.camera.position, positions);
    this.beltField.update(this.simClock.getSimMs());
    this.labels.update(this.camera, positions);

    // Update camera
    this.navigation.update(deltaTime);

    // Compute distances once, share across audio + HUD
    const distances = this.computeDistances(positions);

    // Update audio (distance-based stem mixing + spatial positioning)
    if (this.running) {
      // Update listener position/orientation from camera
      const camPos = this.camera.position;
      this._audioFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this._audioUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const fwd = this._audioFwd;
      const up = this._audioUp;
      this.audioEngine.updateListener(
        [camPos.x, camPos.y, camPos.z],
        [fwd.x, fwd.y, fwd.z],
        [up.x, up.y, up.z]
      );
      this.audioEngine.setBodyPositions(positions);
      this.audioEngine.setTimeDilation(!this.simClock.isLive());
      this.audioEngine.update(distances);
    }

    // Update HUD from pre-computed distances (10Hz — text readouts don't need 60fps)
    if (now - this.lastHudUpdate > 100) {
      this.lastHudUpdate = now;
      this.updateHUD(distances);
    }

    // Apply drift offset for visual rendering only
    this.navigation.applyDrift();
    this.postProcessing.render();
    this.navigation.removeDrift();

    // Update perf monitor
    this.perfMonitor.setResourceCounts({
      activeStems: this.audioEngine.getActiveStems(),
      loadedStems: this.audioEngine.getLoadedStems(),
      activeBodies: this.solarSystem.getBodyCount(),
      texturesLoaded: this.solarSystem.getLoadedTextureCount(),
    });
    this.perfMonitor.endFrame();
  };

  /** Fly to a body and surface its info — shared by HUD menus and 3D label clicks. */
  private focusBody(bodyId: string): void {
    const pos = this.solarSystem.getBodyPosition(bodyId);
    if (!pos) return;
    const visualRadius = this.solarSystem.getBodyVisualRadius(bodyId) ?? undefined;
    this.navigation.flyTo(pos, visualRadius);
    const body = BODIES.find(b => b.id === bodyId);
    if (body) this.hud.showBodyInfo(body);
    // Keep the URL shareable (replaceState: no history spam, no scroll jump)
    if (location.hash !== `#${bodyId}`) {
      history.replaceState(null, '', `#${bodyId}`);
    }
  }

  /** Focus the body named in the URL hash, if any (e.g. /galaxy/#saturn). */
  private applyHashTarget(): void {
    const id = location.hash.replace(/^#\/?/, '').toLowerCase();
    if (id && BODIES.some(b => b.id === id)) {
      this.focusBody(id);
    }
  }

  /** Compute sorted distances from camera to all bodies. Shared by audio + HUD. */
  private computeDistances(positions: Map<string, [number, number, number]>): BodyDistance[] {
    const camPos = this.navigation.getCameraPositionUnits();
    const distances: BodyDistance[] = [];

    for (const body of BODIES) {
      const pos = positions.get(body.id);
      if (!pos) continue;

      const dx = camPos[0] - pos[0];
      const dy = camPos[1] - pos[1];
      const dz = camPos[2] - pos[2];
      const distanceKm = Math.sqrt(dx * dx + dy * dy + dz * dz) * KM_PER_UNIT;

      distances.push({ bodyId: body.id, distanceKm, config: body });
    }

    distances.sort((a, b) => a.distanceKm - b.distanceKm);
    return distances;
  }

  private updateHUD(distances: BodyDistance[]): void {
    const nearest = distances[0];
    this.hud.updateTelemetry(
      nearest ? nearest.config.name : null,
      nearest ? nearest.distanceKm : Infinity,
      this.navigation.getSpeed()
    );
    this.hud.updateTime(
      this.simClock.getDate(),
      this.simClock.getRateLabel(),
      this.simClock.isLive()
    );
    // Live mix readout for the open info panel
    const selectedId = this.hud.getSelectedBodyId();
    if (selectedId) {
      this.hud.updateMix(
        this.audioEngine.getBodyMix(selectedId),
        this.audioEngine.getDroneLevel()
      );
    }
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postProcessing.resize(w, h);
  }
}

App.create();
