import * as THREE from 'three';
import { SolarSystem } from './engine/SolarSystem';
import { Ephemeris } from './engine/Ephemeris';
import { Navigation } from './engine/Navigation';
import { PostProcessing } from './engine/PostProcessing';
import { AudioEngine } from './audio/AudioEngine';
import { HUD } from './ui/HUD';
import { BODIES } from './data/bodies';
import { CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR, KM_PER_UNIT } from './data/constants';

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
    this.audioEngine = new AudioEngine(BODIES);
    this.hud = new HUD();

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

    // Resize
    window.addEventListener('resize', () => this.onResize());

    // Start render loop (audio waits for user gesture via start overlay)
    this.animate();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

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

    // Update audio (distance-based stem mixing)
    if (this.running) {
      this.audioEngine.update(
        this.navigation.getCameraPositionUnits(),
        positions
      );
    }

    // Update HUD
    this.updateHUD(positions);

    // Render with post-processing (bloom)
    this.postProcessing.render();
  };

  private updateHUD(positions: Map<string, [number, number, number]>): void {
    const camPos = this.navigation.getCameraPositionUnits();

    let nearestId: string | null = null;
    let nearestDistKm = Infinity;

    for (const [bodyId, pos] of positions) {
      const dx = camPos[0] - pos[0];
      const dy = camPos[1] - pos[1];
      const dz = camPos[2] - pos[2];
      const distKm = Math.sqrt(dx * dx + dy * dy + dz * dz) * KM_PER_UNIT;

      if (distKm < nearestDistKm) {
        nearestDistKm = distKm;
        nearestId = bodyId;
      }
    }

    const nearestName = nearestId
      ? BODIES.find(b => b.id === nearestId)?.name || nearestId
      : null;

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
