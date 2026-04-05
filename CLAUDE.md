# GalaxyMusic

Solar system explorer where navigation drives ambient music. Fly through space, audio stems fade in/out by proximity to celestial bodies.

## Quick context

- **Product**: Web app (flagship) + future mobile (Capacitor). Consumer/meditation product.
- **Core mechanic**: Each of ~50 celestial bodies has looping audio stems. As camera moves, stems crossfade based on distance. Deep space procedural drone fills the silence between bodies.
- **Stack**: Three.js, TypeScript, Vite, Web Audio API, astronomy-engine. Zero paid dependencies.
- **Status**: Phase 1 architecture built. 9 bodies (Sun + 8 planets). Compiles and builds. No real textures or audio stems yet.

## Project structure

```
app/                          # Vite project root
├── src/
│   ├── main.ts               # Entry — wires all systems together
│   ├── audio/AudioEngine.ts   # THE CORE: distance-based stem mixing, drone
│   ├── engine/SolarSystem.ts  # 3D scene: bodies, starfield, rings, labels
│   ├── engine/Ephemeris.ts    # Real orbital positions (astronomy-engine)
│   ├── engine/Navigation.ts   # Camera: free-flight, focus-travel, touch
│   ├── engine/PostProcessing.ts # Bloom/glow shaders
│   ├── data/bodies.ts         # Body configs (name, radius, stems, gain curves)
│   ├── data/constants.ts      # Scale factors, speeds, audio params
│   ├── types/index.ts         # TypeScript interfaces
│   └── ui/HUD.ts              # Overlay UI (distance, speed, body selector)
├── public/textures/           # Planet textures (empty — needs NASA maps)
├── public/audio/              # Audio stems (empty — needs composed M4A files)
└── index.html
```

## Key design decisions

- All distances in kilometers internally, converted via KM_PER_UNIT (1e6 km = 1 Three.js unit)
- Body sizes exaggerated for visibility (BODY_VISUAL_SCALE = 200x, SUN = 20x)
- Audio format: M4A (AAC) primary for iOS/Safari compat. Stem filenames defined in `data/bodies.ts`
- Gain curves: logarithmic default, audibility radius scaled by body size
- Max 10 concurrent stems. Prefetch at 1.5x audibility radius.
- Ephemeris updates at 1Hz (not every frame). Positions are smooth enough.
- Deep space drone: Web Audio oscillators + filtered noise, fades up when far from all bodies

## Audio stem file structure

Stems live in `public/audio/{bodyId}/`. Names are placeholders — update `data/bodies.ts` to match real files.
Current placeholder names: drone, pad, texture, tone, bass, shimmer, melody — these are arbitrary labels suggesting textural roles, not requirements.

## Commands

```bash
cd app
npm install          # install deps
npx vite             # dev server
npx vite build       # production build
npx tsc --noEmit     # type check
```

## What's NOT built yet

- Real NASA texture maps (fallback colors work)
- Real audio stems (engine ready, no files)
- Smooth journey mode (predefined camera paths)
- Settings panel (HUD toggles)
- Offline/caching
- Mobile (Capacitor)
- Tests
- Eng review (skipped to start building)

## Design doc

Full approved design doc in `DESIGN.md`. Covers: problem statement, premises, phasing strategy, architecture spec, audio engine details, success criteria, distribution plan.
