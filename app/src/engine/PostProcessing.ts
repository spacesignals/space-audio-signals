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

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();

    // Custom render target: HalfFloat keeps HDR headroom for bloom, and MSAA
    // samples restore antialiasing — the composer path bypasses the canvas's
    // own AA, so without this every composed frame renders aliased.
    const renderTarget = new THREE.WebGLRenderTarget(
      Math.round(size.width * pixelRatio),
      Math.round(size.height * pixelRatio),
      { type: THREE.HalfFloatType, samples: 4 }
    );
    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(size.width, size.height);

    // Pass 1: render the scene
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Pass 2: bloom (only bright pixels above threshold)
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width / 2, size.height / 2),
      0.5,   // strength
      0.3,   // radius
      1.2    // threshold — only very bright pixels (Sun core) bloom
    );
    // Bloom is a heavy blur — run it at half resolution (visually identical,
    // large fill-rate saving). Composer.setSize forwards the full size to every
    // pass, so intercept and halve it here.
    const origSetSize = this.bloomPass.setSize.bind(this.bloomPass);
    this.bloomPass.setSize = (w: number, h: number) =>
      origSetSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
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

  /** Update pixel ratio (adaptive resolution scaling) and re-apply size. */
  setPixelRatio(pixelRatio: number, width: number, height: number): void {
    this.composer.setPixelRatio(pixelRatio);
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
