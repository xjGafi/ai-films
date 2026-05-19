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

const SEGMENT_DURATION = 15;
const MAX_REFERENCE_IMAGES = 10;
const MAX_CHARACTER_REFS = 4;

const CAMERA_TYPE_MAP: Record<string, string> = {
  ECU: "大特写",
  CU: "特写",
  MCU: "中近景",
  MS: "中景",
  MWS: "中全景",
  WS: "全景",
  EWS: "大全景",
  OTS: "过肩",
  POV: "第一人称",
  Low: "仰角",
  High: "俯角",
  Bird: "鸟瞰",
  Dutch: "荷兰角",
};

const CAMERA_MOVE_MAP: Record<string, string> = {
  tracking: "跟拍",
  static: "固定镜头",
  "push in": "缓推",
  "push-in": "缓推",
  "pull out": "拉远",
  "pull-out": "拉远",
  "pan left": "左摇",
  "pan right": "右摇",
  pan: "横摇",
  "tilt up": "上仰",
  "tilt down": "下俯",
  tilt: "俯仰",
  crane: "摇臂",
  dolly: "推轨",
  handheld: "手持",
  zoom: "变焦",
  circling: "环绕",
  orbiting: "环绕",
  smooth: "平稳",
  rapid: "快速",
};

const STYLE_CONSTRAINTS: Record<string, string> = {
  cinematic: "电影质感，高清，色彩自然，光影柔和，35mm 胶片颗粒感",
  anime: "2D 日漫风格，赛璐珞着色，动态夸张，表现力丰富",
  "3d-pixar": "3D 皮克斯动画风格，明亮饱和色彩，夸张表情，电影级体积光",
};

/**
 * Stage 3: 为每一段构建中文分镜格式的视频生成提示词。
 *
 * 每段有 9 个镜头，排列为 3×3 分镜网格。
 * 每段 → 一个 15 秒 Seedance 片段。
 * reference_images = [上一段末帧, 分镜图, 角色参考..., 场景参考]
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

    const storyboardRawPath = path.join(
      projectDir,
      "storyboard",
      `act-${act.act}-raw.png`,
    );

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

    const hasPrevLastFrame =
      prevLastFramePath !== undefined && fs.existsSync(prevLastFramePath);
    const hasStoryboard = fs.existsSync(storyboardRawPath);

    const referenceImageRefs = assembleReferenceImages(
      actingCharacters,
      charRefMap,
      hasPrevLastFrame ? prevLastFramePath : undefined,
      hasStoryboard ? storyboardRawPath : undefined,
      sceneRefPath,
    );

    const { text: materialDesc, labels } = buildMaterialDesc(
      act,
      segmentId,
      screenplay.acts.length,
      actingCharacters,
      charRefMap,
      hasPrevLastFrame,
      hasStoryboard,
      sceneRefPath,
      sceneName,
    );

    const continuityNote = buildContinuityNoteV2(
      segmentId,
      prevLastShot,
      shotsWithAct,
      labels.lastFrame,
    );

    const shotSequence = buildShotSequence(act.shots);
    const constraints = buildConstraints(state.config.style, actingCharacters);

    const config: VideoPromptConfig = {
      segmentId,
      mode: "modeB",
      transitionStrategy,
      materialDesc,
      continuityNote,
      shotSequence,
      constraints,
      shots: act.shots,
      style: state.config.style,
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

// ── 角色筛选 ──

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

// ── 参考图片组装 ──

function assembleReferenceImages(
  actingCharacters: CharacterSpec[],
  charRefMap: Map<string, string>,
  prevLastFramePath: string | undefined,
  storyboardRawPath: string | undefined,
  sceneRefPath: string | undefined,
): string[] {
  const refs: string[] = [];

  if (
    prevLastFramePath &&
    fs.existsSync(prevLastFramePath) &&
    refs.length < MAX_REFERENCE_IMAGES
  ) {
    refs.push(prevLastFramePath);
  }

  if (
    storyboardRawPath &&
    fs.existsSync(storyboardRawPath) &&
    refs.length < MAX_REFERENCE_IMAGES
  ) {
    refs.push(storyboardRawPath);
  }

  let charCount = 0;
  for (const char of actingCharacters) {
    if (refs.length >= MAX_REFERENCE_IMAGES) break;
    if (charCount >= MAX_CHARACTER_REFS) break;
    const refPath = charRefMap.get(char.name);
    if (refPath) {
      refs.push(refPath);
      charCount++;
    }
  }

  if (
    sceneRefPath &&
    fs.existsSync(sceneRefPath) &&
    refs.length < MAX_REFERENCE_IMAGES
  ) {
    refs.push(sceneRefPath);
  }

  return refs;
}

// ── 素材说明构建 ──

interface RefLabels {
  lastFrame?: string;
  storyboard?: string;
  characters: string[];
  scene?: string;
}

function buildMaterialDesc(
  act: { act: number; name: string },
  segmentId: number,
  totalSegments: number,
  actingCharacters: CharacterSpec[],
  charRefMap: Map<string, string>,
  hasPrevLastFrame: boolean,
  hasStoryboard: boolean,
  sceneRefPath: string | undefined,
  sceneName: string | undefined,
): { text: string; labels: RefLabels } {
  const lines: string[] = [];
  const labels: RefLabels = { characters: [] };
  let imgIdx = 1;

  lines.push(`本段为第 ${segmentId}/${totalSegments} 段 — ${act.name}。`);
  lines.push("");
  lines.push("【素材说明】");

  if (hasPrevLastFrame) {
    const label = `@图片 ${imgIdx}`;
    labels.lastFrame = label;
    lines.push(`${label} 作为衔接参考，这是上一段的最后一帧。`);
    imgIdx++;
  }

  if (hasStoryboard) {
    const label = `@图片 ${imgIdx}`;
    labels.storyboard = label;
    lines.push(
      `${label} 作为分镜参考，这是本段 9 个镜头的 3×3 分镜图，各格构图按从左到右、从上到下顺序对应镜头 1–9。`,
    );
    imgIdx++;
  }

  let charCount = 0;
  for (const char of actingCharacters) {
    if (charCount >= MAX_CHARACTER_REFS) break;
    if (charRefMap.has(char.name)) {
      const label = `@图片 ${imgIdx}`;
      labels.characters.push(label);
      lines.push(`${label} 作为角色参考（${char.name}）。`);
      imgIdx++;
      charCount++;
    }
  }

  if (sceneRefPath && fs.existsSync(sceneRefPath)) {
    const label = `@图片 ${imgIdx}`;
    labels.scene = label;
    lines.push(`${label} 作为场景参考（${sceneName ?? "本场景"}）。`);
    imgIdx++;
  }

  lines.push("");
  lines.push("【主体定义】");
  charCount = 0;
  let charImgStart = (hasPrevLastFrame ? 1 : 0) + (hasStoryboard ? 1 : 0) + 1;
  for (const char of actingCharacters) {
    if (charCount >= MAX_CHARACTER_REFS) break;
    if (charRefMap.has(char.name)) {
      const briefDesc = char.detail ? char.detail.slice(0, 40) : char.name;
      lines.push(
        `将 @图片 ${charImgStart} 中的${briefDesc}定义为${char.name}。`,
      );
      charImgStart++;
      charCount++;
    }
  }

  if (actingCharacters.length > MAX_CHARACTER_REFS) {
    for (let i = MAX_CHARACTER_REFS; i < actingCharacters.length; i++) {
      const char = actingCharacters[i];
      lines.push(
        `${char.name}：${char.detail ?? "（无描述）"}（无参考图，仅文字描述）。`,
      );
    }
  }

  if (sceneName) {
    lines.push("");
    lines.push("【场景定调】");
    lines.push(
      `场景为「${sceneName}」${labels.scene ? `，匹配 ${labels.scene} 的空间布局、光线方向和整体氛围` : ""}。`,
    );
  }

  return { text: lines.join("\n"), labels };
}

// ── 分镜序列构建 ──

function buildShotSequence(shots: ShotSpec[]): string {
  const lines: string[] = ["【分镜序列】"];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const idx = i + 1;

    const typeZh = CAMERA_TYPE_MAP[shot.type] ?? shot.type;
    const cameraZh =
      CAMERA_MOVE_MAP[shot.camera] ??
      CAMERA_MOVE_MAP[shot.camera?.split(" ")[0] ?? ""] ??
      shot.camera;

    lines.push(`镜头 ${idx}：${typeZh}${cameraZh}，${shot.action}`);
  }

  return lines.join("\n");
}

// ── 约束条件构建 ──

function buildConstraints(
  style: string,
  actingCharacters: CharacterSpec[],
): string {
  const lines: string[] = ["【约束条件】"];

  const charNames = actingCharacters.map((c) => c.name);
  if (charNames.length > 0) {
    lines.push(
      `• 全程保持${charNames.join("、")}的外观一致——面部特征、服装、体型不得漂移`,
    );
  }
  lines.push("• 保持无字幕，避免生成任何文字或字幕");
  lines.push("• 不要生成水印或 Logo");
  lines.push("• 不要引入未定义的角色");
  if (actingCharacters.length > 1) {
    lines.push("• 视频全程禁止出现外形、着装完全一致的人物（禁止双胞胎效果）");
  }
  lines.push("• 人物面部稳定不变形，动作自然流畅，无卡顿无闪烁");

  const styleConstraint =
    STYLE_CONSTRAINTS[style] ?? STYLE_CONSTRAINTS.cinematic;
  lines.push(`• 风格：${styleConstraint}`);

  return lines.join("\n");
}

// ── 衔接要求构建 ──

function buildContinuityNoteV2(
  segmentId: number,
  prevLastShot: (ShotSpec & { actNumber: number }) | undefined,
  shots: Array<ShotSpec & { actNumber: number }>,
  lastFrameLabel: string | undefined,
): string | undefined {
  if (segmentId === 1 || !prevLastShot || !lastFrameLabel) return undefined;

  const firstShot = shots[0];
  const sameScene =
    firstShot?.scene &&
    prevLastShot.scene &&
    firstShot.scene === prevLastShot.scene;

  const lines: string[] = ["【衔接要求】"];

  if (sameScene) {
    lines.push(
      `${lastFrameLabel} 是上一段的结尾画面。开场必须与此画面完全一致：`,
    );
    lines.push("• 相同背景、家具、物体、空间布局");
    lines.push("• 相同光线方向、强度和色温");
    lines.push("• 相同镜头角度和距离");
    lines.push("• 角色位置和姿态与参考图一致");
    lines.push(`前段结尾动作：${prevLastShot.action}`);
  } else {
    lines.push(`${lastFrameLabel} 是上一段的结尾画面。平滑过渡到新场景：`);
    lines.push("• 保持角色外观和服装一致");
    lines.push("• 使用自然过渡（角色转身/行走，揭示新环境）");
    lines.push(`前段结尾动作：${prevLastShot.action}`);
  }

  return lines.join("\n");
}

// ── 转场策略 ──

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
