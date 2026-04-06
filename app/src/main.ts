import * as THREE from 'three';
import { SolarSystem } from './engine/SolarSystem';
import { Ephemeris } from './engine/Ephemeris';
import { Navigation } from './engine/Navigation';
import { PostProcessing } from './engine/PostProcessing';
import { AudioEngine } from './audio/AudioEngine';
import { HUD } from './ui/HUD.tsx';
import { PerformanceMonitor } from './engine/PerformanceMonitor';
import { BODIES } from './data/bodies';
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
  private ephemeris: Ephemeris;
  private navigation: Navigation;
  private postProcessing: PostProcessing;
  private audioEngine: AudioEngine;
  private hud: HUD;
  private perfMonitor: PerformanceMonitor;

  private clock = new THREE.Clock();
  private running = false;

  constructor() {
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
    this.solarSystem = new SolarSystem(this.scene);
    this.navigation = new Navigation(this.camera, this.renderer.domElement);
    this.postProcessing = new PostProcessing(this.renderer, this.scene, this.camera);
    this.audioEngine = new AudioEngine();
    this.hud = new HUD();
    this.perfMonitor = new PerformanceMonitor();

    // Init
    this.solarSystem.initBodies(BODIES);
    this.hud.initBodyList(BODIES);

    // HUD callbacks
    this.hud.setOnBodySelect((bodyId) => {
      const pos = this.solarSystem.getBodyPosition(bodyId);
      if (pos) {
        const visualRadius = this.solarSystem.getBodyVisualRadius(bodyId) ?? undefined;
        this.navigation.flyTo(pos, visualRadius);
        const body = BODIES.find(b => b.id === bodyId);
        if (body) this.hud.showBodyInfo(body);
      }
    });

    this.hud.setOnStart(() => {
      this.audioEngine.init();
      this.running = true;
    });

    // Tour: Sun -> all planets in order
    const tourOrder = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
    this.hud.setOnTour(() => {
      const waypoints = tourOrder.map(id => {
        const pos = this.solarSystem.getBodyPosition(id) || new THREE.Vector3();
        const visualRadius = this.solarSystem.getBodyVisualRadius(id) || 0.1;
        return { bodyId: id, position: pos, visualRadius };
      });
      this.navigation.startTour(
        waypoints,
        (id) => this.solarSystem.getBodyPosition(id),
      );
    });

    // Top view
    this.hud.setOnTopView(() => {
      this.navigation.flyToTopView();
    });

    // Label toggle
    this.hud.setOnToggleLabels((visible) => {
      this.solarSystem.setLabelsVisible(visible);
    });

    // Debug toggle
    this.hud.setOnToggleDebug(() => {
      this.perfMonitor.toggle();
    });

    // Background audio toggle (default: enabled — audio continues when tab hidden)
    let backgroundAudioEnabled = true;
    this.hud.setOnToggleBackgroundAudio((enabled) => {
      backgroundAudioEnabled = enabled;
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

    // Update ephemeris (positions at 1Hz)
    const positions = this.ephemeris.update(now);

    // Update 3D scene
    this.solarSystem.updatePositions(positions);
    this.solarSystem.updateRotations(deltaTime);
    this.solarSystem.updateLabels(this.camera);

    // Update camera
    this.navigation.update(deltaTime);

    // Compute distances once, share across audio + HUD
    const distances = this.computeDistances(positions);

    // Update audio (distance-based stem mixing)
    if (this.running) {
      this.audioEngine.update(distances);
    }

    // Update HUD from pre-computed distances
    this.updateHUD(distances);

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
    const nearestName = nearest
      ? BODIES.find(b => b.id === nearest.bodyId)?.name || nearest.bodyId
      : null;
    const nearestDistKm = nearest ? nearest.distanceKm : Infinity;

    this.hud.updateDistance(nearestName, nearestDistKm);
    this.hud.updateSpeed(this.navigation.getSpeed());
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

new App();
