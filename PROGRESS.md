# GalaxyMusic — Progress

## Timeline

### 2026-04-04 — Design phase
- Ran `/office-hours` (startup mode). Established: taste-risk product, not demand-risk. Founder is the target user.
- 6 premises agreed. Photorealism deferred to later phase (basic visuals first). Hybrid audio model (composed stems + procedural drone).
- Design doc written, 2 rounds adversarial review (27 issues caught and fixed, 8/10 quality score). Approved.
- Chose Approach B: Full Blueprint (build architecture right from the start, no throwaway code).

### 2026-04-05 — Phase 1 build
- Scaffolded Vite + Three.js + TypeScript project
- Built all 6 core modules:
  - **AudioEngine**: per-stem GainNode graph, logarithmic gain curves, stem prefetching, deep space procedural drone (oscillators + filtered noise), max 10 concurrent stems
  - **SolarSystem**: 9 body meshes, 50K starfield, Saturn/Uranus rings, atmosphere glow, sprite labels
  - **Ephemeris**: real-time positions via astronomy-engine at 1Hz
  - **Navigation**: WASD/arrows + mouse drag, focus-travel to bodies, touch + pinch-to-zoom, camera drift
  - **PostProcessing**: custom bloom shader (no external lib)
  - **HUD**: start overlay, distance/speed readouts, body selector, controls hint
- Type checks pass. Production build: 156KB gzipped.
- No real textures or audio stems yet — engine is built and waiting for content.

## What works right now
- Dev server runs (`cd app && npx vite`)
- 9 planets rendered at real orbital positions with fallback colors
- Starfield background
- Free-flight navigation (WASD + mouse)
- Click planet name in HUD to fly there
- Deep space drone plays after clicking start overlay
- Bloom/glow post-processing
- Distance and speed readouts in HUD

## What doesn't work yet
- No audio stems = no planet-specific audio (the core product experience)
- No real textures = colored spheres instead of photorealistic planets
- Smooth journey mode not implemented
- No settings panel
- No tests
- No mobile build
- Eng review was skipped (founder said "build as much as possible" overnight)

## Decisions made
- Stem names in `data/bodies.ts` are arbitrary placeholders (drone, pad, shimmer, etc.) — rename to match real compositions
- M4A format chosen for iOS/Safari compatibility
- Week 0 slider test skipped — founder already knows audio coupling concept works
- Eng review deferred — should run before expanding to Phase 2

## Next priorities
1. Get audio stems from composition partner (critical path)
2. Add NASA 2K texture maps
3. Test the core mechanic: fly Jupiter to Saturn, feel the audio shift
4. Run `/plan-eng-review` before Phase 2
5. Add tests for gain curves, ephemeris, navigation
