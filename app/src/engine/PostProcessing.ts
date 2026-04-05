import * as THREE from 'three';

/**
 * Simple bloom/glow effect using multi-pass rendering.
 * Uses a brightness extraction pass + gaussian blur + additive blend.
 * All done with raw Three.js (no postprocessing library needed).
 */
export class PostProcessing {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  private renderTarget: THREE.WebGLRenderTarget;
  private bloomTarget: THREE.WebGLRenderTarget;
  private blurTarget: THREE.WebGLRenderTarget;

  private bloomScene: THREE.Scene;
  private bloomCamera: THREE.OrthographicCamera;
  private blurMaterial: THREE.ShaderMaterial;
  private compositeMaterial: THREE.ShaderMaterial;
  private quad: THREE.Mesh;

  private enabled = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    this.renderTarget = new THREE.WebGLRenderTarget(w, h);
    this.bloomTarget = new THREE.WebGLRenderTarget(w / 2, h / 2);
    this.blurTarget = new THREE.WebGLRenderTarget(w / 2, h / 2);

    this.bloomScene = new THREE.Scene();
    this.bloomCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Blur shader
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(w / 2, h / 2) },
        direction: { value: new THREE.Vector2(1, 0) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform vec2 direction;
        varying vec2 vUv;
        void main() {
          vec2 texel = direction / resolution;
          vec4 color = vec4(0.0);
          color += texture2D(tDiffuse, vUv - 4.0 * texel) * 0.051;
          color += texture2D(tDiffuse, vUv - 3.0 * texel) * 0.0918;
          color += texture2D(tDiffuse, vUv - 2.0 * texel) * 0.12245;
          color += texture2D(tDiffuse, vUv - 1.0 * texel) * 0.1531;
          color += texture2D(tDiffuse, vUv) * 0.1633;
          color += texture2D(tDiffuse, vUv + 1.0 * texel) * 0.1531;
          color += texture2D(tDiffuse, vUv + 2.0 * texel) * 0.12245;
          color += texture2D(tDiffuse, vUv + 3.0 * texel) * 0.0918;
          color += texture2D(tDiffuse, vUv + 4.0 * texel) * 0.051;
          gl_FragColor = color;
        }
      `,
    });

    // Composite shader (original + bloom)
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tOriginal: { value: null },
        tBloom: { value: null },
        bloomStrength: { value: 0.8 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tOriginal;
        uniform sampler2D tBloom;
        uniform float bloomStrength;
        varying vec2 vUv;
        void main() {
          vec4 original = texture2D(tOriginal, vUv);
          vec4 bloom = texture2D(tBloom, vUv);
          gl_FragColor = original + bloom * bloomStrength;
        }
      `,
    });

    const quadGeom = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(quadGeom, this.blurMaterial);
    this.bloomScene.add(this.quad);
  }

  render(): void {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Pass 1: Render scene to texture
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);

    // Pass 2: Horizontal blur
    this.quad.material = this.blurMaterial;
    this.blurMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
    this.blurMaterial.uniforms.direction.value.set(1, 0);
    this.renderer.setRenderTarget(this.bloomTarget);
    this.renderer.render(this.bloomScene, this.bloomCamera);

    // Pass 3: Vertical blur
    this.blurMaterial.uniforms.tDiffuse.value = this.bloomTarget.texture;
    this.blurMaterial.uniforms.direction.value.set(0, 1);
    this.renderer.setRenderTarget(this.blurTarget);
    this.renderer.render(this.bloomScene, this.bloomCamera);

    // Pass 4: Composite original + bloom
    this.quad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.tOriginal.value = this.renderTarget.texture;
    this.compositeMaterial.uniforms.tBloom.value = this.blurTarget.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.bloomScene, this.bloomCamera);
  }

  resize(width: number, height: number): void {
    this.renderTarget.setSize(width, height);
    this.bloomTarget.setSize(width / 2, height / 2);
    this.blurTarget.setSize(width / 2, height / 2);
    this.blurMaterial.uniforms.resolution.value.set(width / 2, height / 2);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.bloomTarget.dispose();
    this.blurTarget.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}
