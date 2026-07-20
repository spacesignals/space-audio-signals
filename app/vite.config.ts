import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { syncStems } from './scripts/sync-stems.mjs';

// Keep the audio-stem config in lockstep with the files in public/audio/.
// Runs on every vite invocation (build + dev) before the module graph is read,
// so bodies.ts always sees the current folder contents.
syncStems({ log: true });

// Two build targets:
// - default: web deploy to spacesignals.net/galaxy/ (absolute base, outputs to ../deploy)
// - capacitor: native app bundle (relative base so assets load from the local
//   webview filesystem, outputs to dist-mobile for `cap sync`)
export default defineConfig(({ mode }) => {
  const isCapacitor = mode === 'capacitor';
  return {
    base: isCapacitor ? './' : '/galaxy/',
    plugins: [preact()],
    build: {
      outDir: isCapacitor ? 'dist-mobile' : '../deploy',
      emptyOutDir: true,
    },
  };
});
