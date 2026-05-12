// API gateway
export const VOLC_PROXY = "https://ai-apis.medomino.com/proxy/volcengine";

// Endpoints (OpenAI-compatible format)
export const TEXT_API_URL = `${VOLC_PROXY}/api/v3/chat/completions`;
export const IMAGE_API_URL = `${VOLC_PROXY}/api/v3/images/generations`;
export const VIDEO_API_URL = `${VOLC_PROXY}/api/v3/contents/generations/tasks`;

// OpenAI SDK base URL (for chat + images)
export const VOLC_BASE_URL = `${VOLC_PROXY}/api/v3`;

// Models
export const TEXT_MODEL = "doubao-1-5-pro-32k-250115";
export const IMAGE_MODEL = "doubao-seedream-5-0-260128";
export const VIDEO_MODEL = "doubao-seedance-2-0-260128";

// Defaults
export const DEFAULT_DURATION = 60;
export const DEFAULT_RESOLUTION = "720p";
export const DEFAULT_ASPECT_RATIO = "16:9";
export const DEFAULT_SEED = 42;
export const DEFAULT_STYLE = "cinematic";

// Video generation
export const VIDEO_SEGMENT_DURATION = 15; // seconds per Seedance clip
export const VIDEO_POLL_INTERVAL_MS = 10_000; // 10s between polls
export const VIDEO_MAX_POLL_MS = 600_000; // 10 min timeout per clip
export const VIDEO_MAX_RETRIES = 3;

// Frame extraction
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

// Assembly
export const CROSSFADE_DURATION = 0.3; // seconds
export const OUTPUT_FPS = 24;
