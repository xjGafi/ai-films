// ─── Stage names ───

export const STAGE_NAMES = [
  "screenplay",
  "characters",
  "storyboard",
  "prompts",
  "video-gen",
  "transitions",
  "assembly",
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

// ─── Stage state ───

export type StageStatus = "pending" | "in_progress" | "completed" | "failed";

export interface StageState {
  status: StageStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  artifacts: Record<string, string>; // name → file path
  error?: string;
}

// ─── Project config ───

export type VideoStyle = "cinematic" | "anime" | "3d-pixar";

export interface CharacterInput {
  name: string;
  description?: string;
  imagePath?: string;
}

export interface SceneInput {
  id: string;
  imagePath?: string;
}

export interface ProjectConfig {
  story: string;
  duration: number; // 60 | 90 | 120
  style: VideoStyle;
  seed: number;
  resolution: "720p" | "1080p";
  aspectRatio: "16:9";
  characters: CharacterInput[];
  scenes?: SceneInput[];
}

// ─── Project state (persisted) ───

export interface ProjectState {
  projectId: string;
  createdAt: string;
  config: ProjectConfig;
  stages: Record<StageName, StageState>;
}

export interface SceneSpec {
  id: string; // kebab-case, e.g. "lab-int-day"
  name: string; // human-readable, e.g. "现代实验室"
  sceneDescription: string; // full physical environment description
}

// ─── Screenplay (output of Stage 0) ───

export type ShotType =
  | "ECU" // Extreme Close-Up
  | "CU" // Close-Up
  | "MCU" // Medium Close-Up
  | "MS" // Medium Shot
  | "MWS" // Medium Wide Shot
  | "WS" // Wide Shot
  | "EWS" // Extreme Wide Shot
  | "OTS" // Over-the-Shoulder
  | "POV" // Point of View
  | "Low" // Low Angle
  | "High" // High Angle
  | "Bird" // Bird's Eye
  | "Dutch" // Dutch Angle
  | string;

export interface ShotSpec {
  id: number;
  time: string; // "0:00-0:03"
  type: ShotType; // "MS" | "CU" | "EWS" ...
  camera: string; // "tracking" | "low angle" ...
  title?: string; // "The Setup"
  action: string; // detailed action description
  emotion?: string; // "tense" | "joyful" ...
  physics?: string; // "Rigid body collisions"
  pace?: "slow" | "medium" | "fast";
  actionContinuous?: boolean; // true if action flows from previous shot
  scene?: string; // scene identifier for transition logic
}

export interface CharacterSpec {
  id: string;
  name: string;
  detailedDescription: string; // full physical description for prompts
}

export interface ActSpec {
  act: number;
  name: string; // "建置" | "对抗" | "解决"
  durationTarget: number; // target seconds
  emotionalArc?: string; // "calm → tense"
  shots: ShotSpec[];
}

export interface TransitionHint {
  afterShot: number; // shot ID
  strategy: TransitionStrategy;
}

export interface Screenplay {
  title: string;
  totalDuration: number;
  characters: CharacterSpec[];
  scenes: SceneSpec[];
  acts: ActSpec[];
  transitionHints: TransitionHint[];
}

// ─── Transition strategies ───

export type TransitionStrategy =
  | "first_frame_anchor" // frame-exact continuation (chases, fights)
  | "occlusion_transition" // physical occlusion mask (scene changes)
  | "continuity_crossfade" // CONTINUITY NOTE + 0.3s crossfade (default)
  | "hard_cut"; // abrupt cut (montage, fast pace)

// ─── Video prompt (output of Stage 3) ───

export type VideoGenMode = "modeA" | "modeB";
// modeA: image (first frame) + last_frame_image — precise composition
// modeB: reference_images — character consistency, freer composition

export interface VideoPromptConfig {
  segmentId: number;
  mode: VideoGenMode;
  transitionStrategy: TransitionStrategy;
  intent: string;
  referenceDesc: string;
  rules: string[];
  shots: ShotSpec[];
  style: string;
  cameraNotes: string[];
  soundDesign: string;
  negatives: string[];
  endState: string;
  continuityNote?: string;
  totalDuration: number;
  // References
  imageRef?: string; // file path for modeA first frame
  lastFrameRef?: string; // file path for modeA last frame
  referenceImageRefs?: string[]; // file paths for modeB character refs
  seed: number;
}

// ─── Clip info (output of Stage 4) ───

export interface ClipInfo {
  segmentId: number;
  filePath: string; // clips/segment-{N}.mp4
  lastFramePath: string; // frames/segment-{N}-last.png
  duration: number;
  taskId?: string;
}

// ─── Assembly plan (output of Stage 5) ───

export interface AssemblyTransition {
  afterSegment: number;
  strategy: TransitionStrategy;
  crossfadeDuration?: number; // only for continuity_crossfade
}

export interface AssemblyPlan {
  clips: ClipInfo[];
  transitions: AssemblyTransition[];
  outputPath: string;
}

// ─── Stage result ───

export interface StageResult {
  artifacts: Record<string, string>;
}

// ─── Runner options ───

export interface RunOptions {
  fromStage?: StageName;
  clean?: boolean;
  clipIndex?: number; // for regen command
}
