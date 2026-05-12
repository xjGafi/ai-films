import fs from "node:fs";
import path from "node:path";
import { buildSeedancePrompt } from "../../prompts/video-shot.js";
import type {
  Screenplay,
  ShotSpec,
  StageResult,
  TransitionStrategy,
  VideoPromptConfig,
} from "../../types.js";
import type { ProjectState } from "../state.js";

const SHOTS_PER_ROW = 3;
const ROWS_PER_ACT = 3;
const SEGMENT_DURATION = 15;
const ROW_DURATION = SEGMENT_DURATION / ROWS_PER_ACT; // 5s per row

/**
 * Stage 3: Build video generation prompts for each act.
 *
 * Each act has exactly 9 shots arranged in a 3×3 storyboard grid.
 * Row 1 = shots[0..2], Row 2 = shots[3..5], Row 3 = shots[6..8].
 * Each act → one 15-second Seedance clip.
 * reference_images = [row-1 strip, row-2 strip, row-3 strip, ...character refs]
 */
export async function runPromptsStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  const screenplayPath = path.join(projectDir, "screenplay.json");
  const raw = fs.readFileSync(screenplayPath, "utf-8");
  const screenplay: Screenplay = JSON.parse(raw);

  const charactersDir = path.join(projectDir, "characters");
  const charRefMap = new Map<string, string>();
  for (const char of screenplay.characters) {
    const refPath = path.join(charactersDir, `${char.name}-ref.png`);
    if (fs.existsSync(refPath)) {
      charRefMap.set(char.name, refPath);
    }
  }

  const transitionHintMap = new Map<number, TransitionStrategy>();
  for (const hint of screenplay.transitionHints) {
    transitionHintMap.set(hint.afterShot, hint.strategy);
  }

  const promptsDir = path.join(projectDir, "prompts");
  if (!fs.existsSync(promptsDir)) fs.mkdirSync(promptsDir, { recursive: true });

  const storyboardDir = path.join(projectDir, "storyboard");

  const artifacts: Record<string, string> = {};
  let segmentId = 0;
  let prevLastShot: (ShotSpec & { actNumber: number }) | undefined;

  for (const act of screenplay.acts) {
    segmentId++;

    const rowImagePaths = [1, 2, 3].map((rowNum) =>
      path.join(storyboardDir, `act-${act.act}-row-${rowNum}.png`),
    );

    const shotsWithAct = act.shots.map((s) => ({ ...s, actNumber: act.act }));

    const transitionStrategy = determineTransitionStrategy(
      shotsWithAct,
      segmentId,
      transitionHintMap,
      prevLastShot,
    );

    const referenceImageRefs = assembleReferenceImages(
      rowImagePaths,
      screenplay,
      charRefMap,
    );

    const referenceDesc = buildReferenceDescription(
      act.act,
      rowImagePaths,
      screenplay,
      charRefMap,
    );

    const totalSegments = screenplay.acts.length;
    const intent = buildIntent(act, segmentId, totalSegments);
    const rules = buildRules(shotsWithAct, screenplay);
    const cameraNotes = buildCameraNotes(shotsWithAct);
    const soundDesign = buildSoundDesign(shotsWithAct);
    const negatives = buildNegatives(shotsWithAct);
    const endState = buildEndState(shotsWithAct);
    const continuityNote = buildContinuityNote(
      shotsWithAct,
      segmentId,
      prevLastShot,
    );

    const config: VideoPromptConfig = {
      segmentId,
      mode: "modeB",
      transitionStrategy,
      intent,
      referenceDesc,
      rules,
      shots: act.shots,
      style: state.config.style,
      cameraNotes,
      soundDesign,
      negatives,
      endState,
      continuityNote,
      totalDuration: SEGMENT_DURATION,
      seed: state.config.seed,
    };

    if (referenceImageRefs.length > 0) {
      config.referenceImageRefs = referenceImageRefs;
    }

    const promptText = buildSeedancePrompt(config);

    const outPath = path.join(promptsDir, `segment-${segmentId}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ ...config, prompt: promptText }, null, 2),
      "utf-8",
    );
    artifacts[`prompts/segment-${segmentId}.json`] =
      `prompts/segment-${segmentId}.json`;

    prevLastShot = shotsWithAct[shotsWithAct.length - 1];
  }

  return { artifacts };
}

// ── Reference images ──

const MAX_REFERENCE_IMAGES = 9;

function assembleReferenceImages(
  rowImagePaths: string[],
  screenplay: Screenplay,
  charRefMap: Map<string, string>,
): string[] {
  const refs: string[] = [];

  for (const rowPath of rowImagePaths) {
    if (fs.existsSync(rowPath)) refs.push(rowPath);
  }

  for (const char of screenplay.characters) {
    if (refs.length >= MAX_REFERENCE_IMAGES) break;
    const refPath = charRefMap.get(char.name);
    if (refPath) refs.push(refPath);
  }

  return refs;
}

function buildReferenceDescription(
  actNum: number,
  rowImagePaths: string[],
  screenplay: Screenplay,
  charRefMap: Map<string, string>,
): string {
  const parts: string[] = [];
  let imgIdx = 1;

  for (let rowIdx = 0; rowIdx < ROWS_PER_ACT; rowIdx++) {
    const rowPath = rowImagePaths[rowIdx];
    if (rowPath && fs.existsSync(rowPath)) {
      const rowNum = rowIdx + 1;
      const startS = rowIdx * ROW_DURATION;
      const endS = (rowIdx + 1) * ROW_DURATION;
      const first = rowIdx * SHOTS_PER_ROW + 1;
      const last = (rowIdx + 1) * SHOTS_PER_ROW;
      parts.push(
        `[Image${imgIdx}] is the storyboard row for Act ${actNum} Row ${rowNum}, showing shots ${first}–${last} (${startS}–${endS}s) — use for composition and choreography.`,
      );
      imgIdx++;
    }
  }

  for (const char of screenplay.characters) {
    if (imgIdx > MAX_REFERENCE_IMAGES) break;
    if (charRefMap.has(char.name)) {
      parts.push(
        `[Image${imgIdx}] is ${char.name}: ${char.detailedDescription}`,
      );
      imgIdx++;
    } else {
      parts.push(`${char.name}: ${char.detailedDescription}`);
    }
  }

  return parts.join("\n");
}

// ── Transition strategy ──

function determineTransitionStrategy(
  shots: Array<ShotSpec & { actNumber: number }>,
  segmentId: number,
  transitionHintMap: Map<number, TransitionStrategy>,
  prevLastShot: (ShotSpec & { actNumber: number }) | undefined,
): TransitionStrategy {
  if (segmentId === 1) return "continuity_crossfade";

  if (prevLastShot) {
    const hint = transitionHintMap.get(prevLastShot.id);
    if (hint) return hint;
  }

  const firstShot = shots[0];
  if (
    prevLastShot &&
    firstShot &&
    firstShot.actNumber !== prevLastShot.actNumber
  ) {
    if (
      firstShot.scene &&
      prevLastShot.scene &&
      firstShot.scene !== prevLastShot.scene
    ) {
      return "occlusion_transition";
    }
    return "continuity_crossfade";
  }

  const isFastPace =
    shots.filter((s) => s.pace === "fast").length >=
    Math.ceil(shots.length * 0.6);
  if (isFastPace) return "hard_cut";

  return "continuity_crossfade";
}

// ── Prompt component builders ──

function buildIntent(
  act: { act: number; name: string },
  segmentId: number,
  totalSegments: number,
): string {
  return `Segment ${segmentId} of ${totalSegments} — Act ${act.act} (${act.name}).`;
}

function buildRules(
  shots: Array<ShotSpec & { actNumber: number }>,
  screenplay: Screenplay,
): string[] {
  const rules: string[] = [];

  const charNames = screenplay.characters.map((c) => c.name);
  if (charNames.length > 0) {
    rules.push(
      `Maintain exact appearance of ${charNames.join(", ")} throughout all shots — no drift in facial features, clothing, or proportions.`,
    );
  }

  const scenes = [...new Set(shots.map((s) => s.scene).filter(Boolean))];
  if (scenes.length === 1) {
    rules.push(
      `All shots take place in the same scene (${scenes[0]}). Keep environment, lighting, and props consistent.`,
    );
  } else if (scenes.length > 1) {
    rules.push(
      `Scene transitions within this segment must be smooth and motivated by the narrative.`,
    );
  }

  const paceCounts = new Map<string, number>();
  for (const shot of shots) {
    const pace = shot.pace ?? "medium";
    paceCounts.set(pace, (paceCounts.get(pace) ?? 0) + 1);
  }
  const dominantPace =
    [...paceCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "medium";
  if (dominantPace === "fast") {
    rules.push(
      "Urgent rhythm — quick cuts, whip transitions, no pauses between beats.",
    );
  } else if (dominantPace === "slow") {
    rules.push(
      "Slow, contemplative pacing — linger on each shot, smooth camera movements, let moments breathe.",
    );
  }

  return rules;
}

function buildCameraNotes(
  shots: Array<ShotSpec & { actNumber: number }>,
): string[] {
  return shots
    .map((shot) => {
      const parts: string[] = [];
      if (shot.type) parts.push(shot.type);
      if (shot.camera) parts.push(shot.camera);
      return parts.length === 0 ? null : parts.join(" — ");
    })
    .filter((note): note is string => note !== null);
}

function buildSoundDesign(
  shots: Array<ShotSpec & { actNumber: number }>,
): string {
  const emotions = shots.map((s) => s.emotion).filter(Boolean);
  if (emotions.length === 0) {
    return "Subtle ambient soundscape matching the visual mood. Natural environmental audio.";
  }
  return `Sound design follows emotional arc: ${emotions.join(" → ")}. Ambient sounds match the scene environment.`;
}

function buildNegatives(
  shots: Array<ShotSpec & { actNumber: number }>,
): string[] {
  const negatives: string[] = [
    "add text overlays or watermarks",
    "introduce characters not described above",
    "skip or reorder any shot",
    "use cartoon or 3D rendering unless specified in style",
  ];
  if (shots.some((s) => s.pace === "fast")) {
    negatives.push("slow down the action — maintain the fast rhythm");
  }
  return negatives;
}

function buildEndState(shots: Array<ShotSpec & { actNumber: number }>): string {
  const lastShot = shots[shots.length - 1];
  if (!lastShot) return "Scene fades to black.";
  let desc = lastShot.action;
  if (lastShot.emotion) desc += ` Emotion: ${lastShot.emotion}.`;
  desc += " The next clip will continue from this state.";
  return desc;
}

function buildContinuityNote(
  shots: Array<ShotSpec & { actNumber: number }>,
  segmentId: number,
  prevLastShot: (ShotSpec & { actNumber: number }) | undefined,
): string | undefined {
  if (segmentId === 1 || !prevLastShot) return undefined;

  const parts = [
    `This clip must feel like a direct continuation of the previous clip.`,
    `Start with: ${prevLastShot.action}`,
  ];

  const sameScene =
    shots[0]?.scene &&
    prevLastShot.scene &&
    shots[0].scene === prevLastShot.scene;
  if (sameScene) {
    parts.push(
      "Maintain the same scene, same lighting, same camera distance, and same emotional tone.",
    );
  } else {
    parts.push(
      "Transition smoothly to the new scene while maintaining character appearance.",
    );
  }

  return parts.join(" ");
}
