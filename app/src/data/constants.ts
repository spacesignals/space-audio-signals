// Scale factor: 1 Three.js unit = this many km
// Solar system is huge. We use a scale that keeps numbers manageable.
// 1 unit = 1,000,000 km (1e6)
export const KM_PER_UNIT = 1e6;

// Body visual scale multiplier — planets would be invisible dots at true scale.
// This exaggerates body radii for visibility while keeping orbital distances accurate.
export const BODY_VISUAL_SCALE = 200;

// Sun is so big it needs less exaggeration
export const SUN_VISUAL_SCALE = 20;

// Ring visual scale (relative to body scale)
export const RING_VISUAL_SCALE = BODY_VISUAL_SCALE;

// Camera
export const CAMERA_NEAR = 0.001;
export const CAMERA_FAR = 100_000;
export const CAMERA_FOV = 60;

// Navigation defaults
export const FREE_FLIGHT_SPEED = 37.4; // units/second (~15 AU/min)
export const FREE_FLIGHT_SPEED_MIN = 0.01;
export const FREE_FLIGHT_SPEED_MAX = 500; // ~200 AU/min
export const FOCUS_TRAVEL_DURATION_MS = 10_000; // 10 seconds
export const JOURNEY_WAYPOINT_DURATION_MS = 30_000; // 30 seconds per waypoint

// Camera drift for zero-gravity feel
export const CAMERA_DRIFT_AMPLITUDE = 0.0002;
export const CAMERA_DRIFT_FREQUENCY = 0.3;

// Audio
export const MAX_CONCURRENT_STEMS = 10;
export const STEM_PREFETCH_MULTIPLIER = 1.5; // start loading at 1.5x audibility radius
export const DEEP_SPACE_DRONE_MAX_GAIN = 0.3;
export const CROSSFADE_SPEED = 0.02; // gain change per frame (~2-5 seconds full crossfade at 60fps)

// Starfield
export const STARFIELD_COUNT = 15_000;
export const STARFIELD_RADIUS = 50_000; // units
