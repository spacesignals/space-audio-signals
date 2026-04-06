import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * PostProcessing wraps Three.js EffectComposer with UnrealBloomPass.
 * Bloom is selective: only bright objects (Sun, atmospheres) glow.
 */
export class PostProcessing {
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private enabled = true;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    this.composer = new EffectComposer(renderer);

    // Pass 1: render the scene
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Pass 2: bloom (only bright pixels above threshold)
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.8,   // strength
      0.4,   // radius
      0.85   // threshold — only bright objects (Sun, emissives) bloom
    );
    this.composer.addPass(this.bloomPass);

    // Pass 3: tone mapping output
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  render(): void {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render();
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setBloomStrength(strength: number): void {
    this.bloomPass.strength = strength;
  }

  setBloomThreshold(threshold: number): void {
    this.bloomPass.threshold = threshold;
  }

  setBloomRadius(radius: number): void {
    this.bloomPass.radius = radius;
  }

  dispose(): void {
    this.composer.dispose();
  }
}
