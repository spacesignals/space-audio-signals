# TODOS

Items deferred from eng review (2026-04-05). Context preserved for future pickup.

## Background Audio Toggle
**What:** HUD checkbox (default: enabled) controlling whether audio continues when tab is hidden or screen is off.
**Why:** Core use case is meditation/sleep. Users need audio to keep playing with screen off. When disabled, `visibilitychange` pauses AudioContext and resumes on return. Handle iOS audio session quirks (`resume()` promise rejection).
**Where to start:** Add toggle to HUD (Preact component after migration). Wire to `visibilitychange` listener in main.ts. iOS may need `<audio>` element trick for background playback.
**Depends on:** HUD Preact migration.
**Added:** 2026-04-05 (eng review, outside voice finding)

## MAX_CONCURRENT_STEMS Scaling
**What:** Redesign stem concurrency to support 5-10 audible bodies simultaneously at 50 bodies.
**Why:** Current limit of 10 stems = ~3 audible bodies (Jupiter uses 3 stems). Design doc success criterion: "50 bodies with audio for nearest 5-10 active." Options: (a) increase to 20-30, (b) dynamic budget giving closest bodies more stems, (c) reduce stems-per-body for Phase 2+ bodies to 1-2.
**Where to start:** Profile on target mobile device to find real limit. Then choose approach.
**Depends on:** Mobile performance testing, Phase 2 body data.
**Added:** 2026-04-05 (eng review, cross-model tension between review and outside voice)

## Tour Live Position Tracking
**What:** Update travel destination during tour travel phase to track moving planets.
**Why:** `startTourTravel` captures `travelEnd` as a static point. Mercury's orbital velocity causes destination drift during 2s travel. Orbit phase correctly tracks live positions but travel doesn't. Causes slight visual "snap" at travel→orbit transition.
**Where to start:** In `Navigation.updateTour()` travel branch, re-query `getBodyPosition(bodyId)` each frame and update `travelEnd` + `travelLookTarget`.
**Depends on:** None.
**Added:** 2026-04-05 (eng review, outside voice finding)

## CI/CD Pipeline
**What:** GitHub Actions workflow: type-check → test → build → deploy to static host on merge to main.
**Why:** Design doc specifies automated deployment. Code without distribution is code nobody can use. Gives audio partner a live URL.
**Where to start:** `.github/workflows/deploy.yml`. Steps: `npm ci` → `npx tsc --noEmit` → `npx vitest run` → `npx vite build`. Deploy `app/dist/` to Vercel/Netlify/GH Pages.
**Depends on:** Choose hosting provider.
**Added:** 2026-04-05 (eng review, distribution check)
