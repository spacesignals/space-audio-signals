# GalaxyMusic — Project Map

## Docs in this folder
| File | Purpose |
|------|---------|
| `CLAUDE.md` | Context for the next Claude session (read this first) |
| `PROGRESS.md` | Timeline, what works, what doesn't, decisions made |
| `DESIGN.md` | Full approved design doc (problem, premises, architecture, phasing) |
| `PROJECT_MAP.md` | This file — high-level orientation |

## Status: Phase 1 architecture built, waiting on audio content

The app skeleton is done. 9 bodies, real orbital positions, navigation, bloom/glow, HUD. The audio engine is wired and ready. Zero audio stems or textures exist yet.

## Phasing
1. ~~Week 0: Slider test~~ — Skipped
2. **Phase 1** (current): Sun + 8 planets, web only, basic visuals ← **architecture done, needs content**
3. Phase 2: Moons + dwarf planets (~30), Capacitor mobile, time controls, photorealism
4. Phase 3: Full catalog (~50), asteroid belt, app stores

## To run
```bash
cd app && npx vite
```

## Critical path
Audio stems from composition partner. Everything else is built or buildable.
