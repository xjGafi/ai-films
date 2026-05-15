import fs from "node:fs";
import path from "node:path";
import { buildSeedancePrompt } from "../../prompts/video-shot.js";
import type {
  CharacterSpec,
  SceneSpec,
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
function getPrimaryScene(shots: ShotSpec[]): string | undefined {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    if (shot.scene) counts.set(shot.scene, (counts.get(shot.scene) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

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

  const framesDir = path.join(projectDir, "frames");

  const scenesDir = path.join(projectDir, "scenes");
  const sceneRefMap = new Map<string, string>();
  if (fs.existsSync(scenesDir)) {
    for (const f of fs.readdirSync(scenesDir)) {
      if (f.endsWith("-ref.png")) {
        sceneRefMap.set(f.replace("-ref.png", ""), path.join(scenesDir, f));
      }
    }
  }

  const sceneSpecMap = new Map<string, SceneSpec>(
    (screenplay.scenes ?? []).map((s) => [s.id, s]),
  );

  const artifacts: Record<string, string> = {};
  let segmentId = 0;
  let prevLastShot: (ShotSpec & { actNumber: number }) | undefined;

  for (const act of screenplay.acts) {
    segmentId++;

    const primarySceneId = getPrimaryScene(act.shots);
    const sceneRefPath = primarySceneId
      ? sceneRefMap.get(primarySceneId)
      : undefined;
    const sceneName = primarySceneId
      ? sceneSpecMap.get(primarySceneId)?.name
      : undefined;

    const prevLastFramePath =
      segmentId > 1
        ? path.join(framesDir, `segment-${segmentId - 1}-last.png`)
        : undefined;

    const shotsWithAct = act.shots.map((s) => ({ ...s, actNumber: act.act }));

    // 过滤出本段实际出场的角色
    const actingCharacters = getActingCharacters(
      act.shots,
      screenplay.characters,
    );

    const transitionStrategy = determineTransitionStrategy(
      shotsWithAct,
      segmentId,
      transitionHintMap,
      prevLastShot,
    );

    const referenceImageRefs = assembleReferenceImages(
      actingCharacters,
      charRefMap,
      prevLastFramePath,
      sceneRefPath,
    );

    const hasPrevLastFrame =
      prevLastFramePath !== undefined && fs.existsSync(prevLastFramePath);

    const referenceDesc = buildReferenceDescription(
      actingCharacters,
      charRefMap,
      hasPrevLastFrame,
      sceneRefPath,
      sceneName,
    );

    const totalSegments = screenplay.acts.length;
    const isLastSegment = segmentId === screenplay.acts.length;
    const intent = buildIntent(act, segmentId, totalSegments);
    const rules = buildRules(
      shotsWithAct,
      actingCharacters,
      segmentId,
      hasPrevLastFrame,
    );
    const cameraNotes = buildCameraNotes(shotsWithAct);
    const soundDesign = buildSoundDesign(shotsWithAct);
    const negatives = buildNegatives(shotsWithAct, state.config.style);
    const endState = buildEndState(shotsWithAct, isLastSegment);
    const continuityNote = buildContinuityNote(
      shotsWithAct,
      segmentId,
      prevLastShot,
      hasPrevLastFrame,
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

/**
 * 过滤出在本段镜头中实际出现的角色。
 * 通过检查 shot.action 和 shot.title 文本中是否包含角色名或 (id) 来判断。
 * 安全兜底：如果没有任何匹配，返回全部角色。
 */
function getActingCharacters(
  shots: ShotSpec[],
  characters: CharacterSpec[],
): CharacterSpec[] {
  const allText = shots.map((s) => `${s.action} ${s.title ?? ""}`).join(" ");
  const acting = characters.filter(
    (char) => allText.includes(char.name) || allText.includes(`(${char.id})`),
  );
  return acting.length > 0 ? acting : characters;
}

function assembleReferenceImages(
  actingCharacters: CharacterSpec[],
  charRefMap: Map<string, string>,
  prevLastFramePath: string | undefined,
  sceneRefPath: string | undefined,
): string[] {
  const refs: string[] = [];

  // prevLastFrame 优先 — 模型最需要它来保持跨片段的视觉连续性
  if (
    prevLastFramePath &&
    fs.existsSync(prevLastFramePath) &&
    refs.length < MAX_REFERENCE_IMAGES
  ) {
    refs.push(prevLastFramePath);
  }

  // 然后是本段实际出场的角色
  for (const char of actingCharacters) {
    if (refs.length >= MAX_REFERENCE_IMAGES) break;
    const refPath = charRefMap.get(char.name);
    if (refPath) refs.push(refPath);
  }

  // 场景参考图放最后
  if (
    sceneRefPath &&
    refs.length < MAX_REFERENCE_IMAGES &&
    fs.existsSync(sceneRefPath)
  ) {
    refs.push(sceneRefPath);
  }

  return refs;
}

function buildReferenceDescription(
  actingCharacters: CharacterSpec[],
  charRefMap: Map<string, string>,
  hasPrevLastFrame: boolean,
  sceneRefPath: string | undefined,
  sceneName: string | undefined,
): string {
  const parts: string[] = [];
  let imgIdx = 1;

  // prevLastFrame 在数组第一位，所以描述也放第一条
  if (hasPrevLastFrame) {
    parts.push(
      `[Image${imgIdx}] is the EXACT last frame of the previous clip. Your opening frames MUST match this image — same background, same lighting, same color palette, same character positions, same camera angle. This is the highest-priority continuity reference.`,
    );
    imgIdx++;
  }

  // 本段实际出场的角色
  for (const char of actingCharacters) {
    if (imgIdx > MAX_REFERENCE_IMAGES) break;
    const desc = char.detail;
    if (charRefMap.has(char.name)) {
      parts.push(`[Image${imgIdx}] is ${char.name}: ${desc}`);
      imgIdx++;
    } else {
      parts.push(`${char.name}: ${desc}`);
    }
  }

  // 场景参考图放最后
  if (sceneRefPath && fs.existsSync(sceneRefPath)) {
    const label = sceneName ?? "this scene";
    parts.push(
      `[Image${imgIdx}] is the reference environment for scene "${label}" — match this exact room layout, wall colors, lighting, and spatial arrangement throughout all shots.`,
    );
    imgIdx++;
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

  const firstShot = shots[0];

  if (prevLastShot) {
    const hint = transitionHintMap.get(prevLastShot.id);
    if (hint) {
      // occlusion_transition 要求两个镜头处于同一物理空间，否则降级为 hard_cut
      if (hint === "occlusion_transition") {
        const sameScene =
          prevLastShot?.scene &&
          firstShot?.scene &&
          prevLastShot.scene === firstShot.scene;
        if (!sameScene) return "hard_cut";
      }
      return hint;
    }
  }

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
      return "hard_cut";
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
  actingCharacters: CharacterSpec[],
  segmentId: number,
  hasPrevLastFrame: boolean,
): string[] {
  const rules: string[] = [];

  // 只列出本段实际出场的角色
  const charNames = actingCharacters.map((c) => c.name);
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

  if (segmentId > 1 && hasPrevLastFrame) {
    rules.push(
      `The first 2 seconds of this clip must be visually continuous with [Image1] — match the background, lighting, color temperature, and character positions exactly.`,
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
  style: string,
): string[] {
  // 3d-pixar 风格本身就是 3D，禁止 2D 扁平风格；其他风格禁止 3D/卡通渲染
  const renderingNegative =
    style === "3d-pixar"
      ? "use flat 2D cartoon style"
      : "use cartoon or 3D rendering unless specified in style";

  const negatives: string[] = [
    "add production watermarks, subtitles, or captions not described in the shots",
    "introduce characters not described above",
    "skip or reorder any shot",
    renderingNegative,
  ];
  if (shots.some((s) => s.pace === "fast")) {
    negatives.push("slow down the action — maintain the fast rhythm");
  }
  return negatives;
}

function buildEndState(
  shots: Array<ShotSpec & { actNumber: number }>,
  isLastSegment: boolean,
): string {
  const lastShot = shots[shots.length - 1];
  if (!lastShot) return "Scene fades to black.";
  let desc = lastShot.action;
  if (lastShot.emotion) desc += ` Emotion: ${lastShot.emotion}.`;
  // 最后一段不需要「下一片段继续」的提示
  if (isLastSegment) {
    desc += " This is the final scene. The film ends here.";
  } else {
    desc += " The next clip will continue from this state.";
  }
  return desc;
}

function buildContinuityNote(
  shots: Array<ShotSpec & { actNumber: number }>,
  segmentId: number,
  prevLastShot: (ShotSpec & { actNumber: number }) | undefined,
  hasPrevLastFrame: boolean,
): string | undefined {
  if (segmentId === 1 || !prevLastShot) return undefined;

  const sameScene =
    shots[0]?.scene &&
    prevLastShot.scene &&
    shots[0].scene === prevLastShot.scene;

  if (hasPrevLastFrame && sameScene) {
    return [
      "VISUAL CONTINUITY — SAME SCENE:",
      "[Image1] shows exactly where the previous clip ended. Your opening frames must match:",
      "• Background: identical walls, furniture, objects, spatial layout",
      "• Lighting: same direction, intensity, and color temperature",
      "• Camera: same angle and distance from subjects",
      "• Characters: same positions and poses as shown in [Image1]",
      `Action continues from: ${prevLastShot.action}`,
    ].join("\n");
  }

  if (hasPrevLastFrame && !sameScene) {
    return [
      "VISUAL CONTINUITY — SCENE TRANSITION:",
      "[Image1] shows the previous clip's ending. Transition smoothly to the new scene while:",
      "• Maintaining consistent character appearance and costume",
      "• Using a natural transition (the character walks/turns to reveal the new environment)",
      `Action continues from: ${prevLastShot.action}`,
    ].join("\n");
  }

  // Fallback: no last frame available (first pipeline run, stage 3 pass)
  const parts = [
    "This clip must feel like a direct continuation of the previous clip.",
    `Start with: ${prevLastShot.action}`,
  ];
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
