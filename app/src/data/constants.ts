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
export const CAMERA_FOV = 50;

// Navigation defaults
export const FREE_FLIGHT_SPEED = 37.4; // units/second (~15 AU/min)
export const FREE_FLIGHT_SPEED_MIN = 0.01;
export const FREE_FLIGHT_SPEED_MAX = 500; // ~200 AU/min
export const FOCUS_TRAVEL_DURATION_MS = 10_000; // 10 seconds

// Camera drift for zero-gravity feel
export const CAMERA_DRIFT_AMPLITUDE = 0.0002;
export const CAMERA_DRIFT_FREQUENCY = 0.3;

// Audio
export const MAX_CONCURRENT_STEMS = 24;
export const STEM_PREFETCH_MULTIPLIER = 1.5; // start loading at 1.5x audibility radius
export const DEEP_SPACE_DRONE_MAX_GAIN = 0.3;
export const CROSSFADE_TIME_CONSTANT = 0.8; // seconds — exponential approach time constant for setTargetAtTime
export const DRONE_CROSSFADE_TIME_CONSTANT = 1.5; // seconds — slower crossfade for deep space drone
export const STEM_RETRY_COOLDOWN_MS = 60_000; // wait 60s before retrying a failed stem
export const STEM_MAX_RETRIES = 1; // retry once after cooldown, then permanently fail
export const STEM_EVICTION_DELAY_MS = 30_000; // evict silent stems after 30s
export const STEM_DELAY_SECONDS = 60; // delay/ layer starts this many seconds after a body becomes audible
export const DELAYED_STEM_FADE_IN_TIME_CONSTANT = 1.5; // seconds — fade-in when a delayed stem's source starts, avoids a pop
// Fraction of each stem mixed un-panned (dead center) so a hard-panned body is
// never fully silent in one ear — keeps the quiet ear at ~6% of the loud ear.
export const PAN_CENTER_BLEED = 0.07;
// Time constant for smoothing panner position moves — prevents zipper/pan
// clicks when a body's position snaps (e.g. 1 Hz ephemeris updates).
export const PANNER_SMOOTH_TIME_CONSTANT = 0.04; // seconds
// Time constant for smoothing master-volume changes (slider drags, ducking).
export const MASTER_VOLUME_SMOOTH_TIME_CONSTANT = 0.05; // seconds

// Starfield
export const STARFIELD_RADIUS = 50_000; // units
