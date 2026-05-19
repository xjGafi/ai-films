# Prompt 模板官方规范对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Seedance 视频生成的 prompt 模板全面对齐官方提示词指南——中文分镜格式、@ 语法素材引用、去除时间戳、引入分镜图参考。

**Architecture:** 改动从上游到下游分 4 个独立任务：(1) Stage 0 prompt 中文化；(2) types.ts 调整 VideoPromptConfig；(3) Stage 3 重构 prompt 构建逻辑；(4) Stage 4 适配 last-frame 注入。每个任务独立可编译。

**Tech Stack:** TypeScript, Node.js (ESM), pnpm

---

## File Structure

| File | Role |
|------|------|
| `src/prompts/screenplay.ts` | Task 1: Stage 0 LLM prompt 中文化 |
| `src/types.ts` | Task 2: VideoPromptConfig 新字段 |
| `src/prompts/video-shot.ts` | Task 3: buildSeedancePrompt 重写 |
| `src/pipeline/stages/3-prompts.ts` | Task 3: 参考图组装 + 镜头格式转换 |
| `src/pipeline/stages/4-video-gen.ts` | Task 4: last-frame 注入适配新格式 |

---

### Task 1: Stage 0 Screenplay Prompt 中文化

**Files:**
- Modify: `src/prompts/screenplay.ts`

**目标**：让 LLM 生成中文叙事内容（action, title, act.name, scene.name, character.detail），结构字段（type, camera, pace, emotion）保留英文枚举。

- [ ] **Step 1: 修改 SYSTEM_PROMPT 为中文**

将 `src/prompts/screenplay.ts` 中的 `SYSTEM_PROMPT` 常量替换。保留 JSON schema 部分不变（字段名是英文），将所有指令文本改为中文，并在开头加上语言要求。

关键新增/修改的指令：

```typescript
const SYSTEM_PROMPT = `你是一位专业的电影编剧和分镜架构师。你的任务是将故事描述转化为结构化剧本，供自动化 AI 视频生产流水线直接使用。

【输出语言要求】
- 所有叙事内容（action、title、act name、scene name、scene description、scene detail、character detail）必须使用中文
- 结构字段保留英文枚举值：type（ECU/CU/MS/WS 等）、camera（tracking/static/pan left 等）、pace（slow/medium/fast）、emotion（tense/joyful 等）
- 专业术语可保留英文（如 Seedance、pipeline 等）

你必须输出符合以下 schema 的合法 JSON（不要 markdown 代码块，不要额外注释——只有 JSON 对象）：

{json schema 保持不变...}

【核心要求】：

1. 每幕镜头数：每幕必须恰好包含 9 个镜头——不多不少。这是分镜流水线的硬性要求（9 镜头 = 3×3 网格）。不要包含 "time" 字段——时间戳由 pace 值自动计算。

2. 总时长：幕数由用户消息给出——生成恰好该数量的幕，每幕 durationTarget 为 15 秒。

3. 转场提示：在每幕（除最后一幕）的最后一个镜头后插入 transitionHint。策略选择：
   - "first_frame_anchor" — 同场景，连续动作跨越幕切割（追逐、打斗）
   - "occlusion_transition" — 场景切换（用物理遮挡掩盖切割）
   - "continuity_crossfade" — 同场景，不同动作（默认，0.3s 叠化）
   - "hard_cut" — 蒙太奇，快节奏，刻意跳切

4. 镜头类型：使用标准电影缩写：
   ECU（大特写）、CU（特写）、MCU（中近景）、MS（中景）、MWS（中全景）、WS（全景）、EWS（大全景）、OTS（过肩）、POV（第一人称）、Low（仰角）、High（俯角）、Bird（鸟瞰）、Dutch（荷兰角）

5. 角色描述：每个角色必须有 "detail" 字段，包含完整精确的外貌描述，适合在图像和视频生成提示词中复用。包括：
   - 年龄、体型、身高印象
   - 发型：颜色、样式、长度、质地（用精确颜色词如"炭灰色"）
   - 面部：脸型、显著特征、表情风格
   - 服装：具体服饰、颜色、面料、配饰
   - 辨识标志：疤痕、纹身、首饰
   不要使用"同前"之类的模糊指代——每个描述必须自足完整。

6. 动作描述：必须具体而视觉化。描述摄像机看到的画面，不是抽象叙事。包括：
   - 角色位置和动作
   - 与环境的物理交互
   - 屏幕上可见的情绪表达
   - 相关道具或物体
   - 首次出现标签：角色在某镜头首次出场时，在名字后附加 id 括号：如"老王（character-1）坐在长椅上"

7. 镜头节奏："pace" 字段控制剪辑节奏和镜头时长：
   - slow：长镜头，沉思，风景，情绪（获得更多画面时间）
   - medium：标准节奏，叙事场景，对话（默认权重）
   - fast：短促镜头，动作，冲击，快切（获得较少画面时间）

8. 运镜语言：使用精确的运镜术语：
   - 运动：tracking, dolly, pan (left/right), tilt (up/down), push-in, pull-out, crane, handheld, static, zoom
   - 修饰：smooth, rapid, slow, gentle, violent, circling, orbiting

9. 场景标识：使用 "scene-1", "scene-2" 格式。角色标识使用 "character-1", "character-2" 格式。如提供了固定场景/角色，使用其原始 id。

10. 场景描述：每个独立场所一个条目。"detail" 必须覆盖：空间布局、墙面/地板/天花板材质颜色、家具和道具摆放、光线方向/强度/色温/氛围、整体色调。

重要：JSON 字符串值内绝不使用 ASCII 双引号（"）——会破坏 JSON 解析。在字符串值内使用中文引号（「」或『』）或单引号（'）。

11. 禁止填充镜头：不要用空白视觉节拍填充，如淡入黑屏、片头卡、"屏幕变暗"或重复拉远序列。每个镜头都必须包含有意义的叙事动作或角色表演。

12. 运镜多样性：单幕中 "static" 镜头不超过 40%。积极变化运镜方式。

13. 节奏变化：每幕至少使用 2 种不同的 pace 值。单一节奏会扼杀韵律。

14. 角色描述禁止场景道具：detail 只描述角色永久外貌。场景特定道具属于 shot action，不属于角色定义。

15. 角色描述禁止模板化语言：避免"五官精致""眼神锐利"等通用泛化词。描述具体、有辨识度的视觉特征。

16. 群体角色：如果角色代表一组相同人物，detail 必须以"一组相同的[N个]..."开头。

17. 比例变化：如角色以非标准尺寸出现，action 中必须包含具体尺寸参照物。

18. 场景转换镜头：连续幕处于不同场景时，新幕第一个镜头必须包含叙事或心理上的桥接元素。`;
```

- [ ] **Step 2: 修改 userPrompt 为中文**

```typescript
const userPrompt = `为以下影片生成完整的结构化剧本：

故事：
${story}

角色：
${characterList}
${fixedScenesBlock}
目标时长：${duration} 秒
视觉风格：${style}

现在生成 JSON 剧本。记住：
- 每幕必须恰好 9 个镜头（无 "time" 字段——时间戳由 pace 自动计算）
- 总幕数：${numActs} 幕（${numActs} × 15s = ${numActs * 15}s）
- 在每个幕边界插入 transitionHints（每幕最后一个镜头之后，最后一幕除外）
- 角色描述必须详细到可用于图像生成提示词
- 如果角色已有 FIXED DESCRIPTION，原样复制到 "detail" 字段——不要改写
- 动作描述必须视觉化、以摄像机视角为导向
- 所有叙事内容（action、title、act name、scene name/description/detail）使用中文
- 结构字段保留英文：type、camera、pace、emotion`;
```

- [ ] **Step 3: 修改 fixedScenesBlock 提示为中文**

```typescript
fixedScenesBlock = `\n固定场景（原样使用——相同 id、name、detail——不要重命名或改写）：\n${sceneLines}\n\n所有镜头的 "scene" 字段必须引用这些 id 之一（${scenes.map((s) => s.id).join(", ")}）。\n`;
```

- [ ] **Step 4: 运行 typecheck 验证**

Run: `cd /Users/vincent/work/ai-films && pnpm run typecheck`
Expected: 无报错（只是修改字符串内容，类型不变）

- [ ] **Step 5: Commit**

```bash
git add src/prompts/screenplay.ts
git commit -m "feat: stage 0 prompt 中文化，要求 LLM 输出中文叙事内容"
```

---

### Task 2: VideoPromptConfig 类型调整

**Files:**
- Modify: `src/types.ts`

**目标**：用新字段替代旧字段，支持中文分镜式 prompt 结构。保留旧字段为 optional 以兼容已有的 segment JSON 文件。

- [ ] **Step 1: 在 VideoPromptConfig 中新增字段**

在 `src/types.ts` 的 `VideoPromptConfig` 接口末尾（`seed` 之前）新增：

```typescript
export interface VideoPromptConfig {
  segmentId: number;
  mode: VideoGenMode;
  transitionStrategy: TransitionStrategy;
  // 旧字段（保留为 optional 以兼容已有 JSON）
  intent?: string;
  referenceDesc?: string;
  rules?: string[];
  shots: ShotSpec[];
  style: string;
  cameraNotes?: string[];
  soundDesign?: string;
  negatives?: string[];
  endState?: string;
  continuityNote?: string;
  totalDuration: number;
  // 新字段（中文分镜格式）
  materialDesc?: string;       // 【素材说明】+【主体定义】+【场景定调】
  shotSequence?: string;       // 【分镜序列】
  constraints?: string;        // 【约束条件】
  // References
  imageRef?: string;
  lastFrameRef?: string;
  referenceImageRefs?: string[];
  seed: number;
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `cd /Users/vincent/work/ai-films && pnpm run typecheck`
Expected: 无报错（新字段都是 optional，不影响已有代码）

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: VideoPromptConfig 新增 materialDesc/shotSequence/constraints 字段"
```

---

### Task 3: Stage 3 + video-shot.ts 重构

**Files:**
- Modify: `src/prompts/video-shot.ts`
- Modify: `src/pipeline/stages/3-prompts.ts`

**目标**：重写 prompt 构建逻辑——@ 语法、中文分镜格式、引入分镜图、去除时间戳。

- [ ] **Step 1: 重写 `src/prompts/video-shot.ts`**

整个文件替换为新的简洁实现：

```typescript
import type { VideoPromptConfig } from "../types.js";

/**
 * 构建 Seedance 2.0 视频生成提示词。
 * 对齐官方提示词指南（2026.05.15）的中文分镜格式。
 *
 * 结构：
 *   1. 【素材说明】+ 【主体定义】+ 【场景定调】
 *   2. 【衔接要求】（segment 2+ 才有）
 *   3. 【分镜序列】
 *   4. 【约束条件】
 */
export function buildSeedancePrompt(config: VideoPromptConfig): string {
  const parts: string[] = [];

  if (config.materialDesc) {
    parts.push(config.materialDesc);
  }

  if (config.continuityNote) {
    parts.push(config.continuityNote);
  }

  if (config.shotSequence) {
    parts.push(config.shotSequence);
  }

  if (config.constraints) {
    parts.push(config.constraints);
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 2: 重写 `src/pipeline/stages/3-prompts.ts` — 运镜术语映射**

在文件顶部（import 之后）添加运镜映射表和风格模板：

```typescript
const CAMERA_TYPE_MAP: Record<string, string> = {
  ECU: "大特写", CU: "特写", MCU: "中近景", MS: "中景",
  MWS: "中全景", WS: "全景", EWS: "大全景",
  OTS: "过肩", POV: "第一人称",
  Low: "仰角", High: "俯角", Bird: "鸟瞰", Dutch: "荷兰角",
};

const CAMERA_MOVE_MAP: Record<string, string> = {
  tracking: "跟拍", static: "固定镜头", "push in": "缓推", "push-in": "缓推",
  "pull out": "拉远", "pull-out": "拉远", "pan left": "左摇", "pan right": "右摇",
  pan: "横摇", "tilt up": "上仰", "tilt down": "下俯", tilt: "俯仰",
  crane: "摇臂", dolly: "推轨", handheld: "手持", zoom: "变焦",
  circling: "环绕", orbiting: "环绕",
};

const STYLE_CONSTRAINTS: Record<string, string> = {
  cinematic: "电影质感，高清，色彩自然，光影柔和，35mm 胶片颗粒感，ARRI ALEXA 美学",
  anime: "2D 日漫风格，赛璐珞着色，动态夸张，表现力丰富的动作",
  "3d-pixar": "3D 皮克斯动画风格，明亮饱和色彩，夸张的表情，平滑次表面散射，电影级体积光",
};

const MAX_REFERENCE_IMAGES = 10;
const MAX_CHARACTER_REFS = 4;
```

- [ ] **Step 3: 重写 `assembleReferenceImages` 函数**

```typescript
function assembleReferenceImages(
  actingCharacters: CharacterSpec[],
  charRefMap: Map<string, string>,
  prevLastFramePath: string | undefined,
  storyboardRawPath: string | undefined,
  sceneRefPath: string | undefined,
): string[] {
  const refs: string[] = [];

  // 1. 衔接参考（上一段最后一帧）
  if (prevLastFramePath && fs.existsSync(prevLastFramePath) && refs.length < MAX_REFERENCE_IMAGES) {
    refs.push(prevLastFramePath);
  }

  // 2. 分镜参考（完整 3×3 分镜图）
  if (storyboardRawPath && fs.existsSync(storyboardRawPath) && refs.length < MAX_REFERENCE_IMAGES) {
    refs.push(storyboardRawPath);
  }

  // 3. 角色参考（soft limit 4 张）
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

  // 4. 场景参考
  if (sceneRefPath && fs.existsSync(sceneRefPath) && refs.length < MAX_REFERENCE_IMAGES) {
    refs.push(sceneRefPath);
  }

  return refs;
}
```

- [ ] **Step 4: 新增 `buildMaterialDesc` 函数**

```typescript
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

  // 衔接参考
  if (hasPrevLastFrame) {
    const label = `@图片 ${imgIdx}`;
    labels.lastFrame = label;
    lines.push(`${label} 作为衔接参考，这是上一段的最后一帧。`);
    imgIdx++;
  }

  // 分镜参考
  if (hasStoryboard) {
    const label = `@图片 ${imgIdx}`;
    labels.storyboard = label;
    lines.push(`${label} 作为分镜参考，这是本段 9 个镜头的 3×3 分镜图，各格构图按从左到右、从上到下顺序对应镜头 1–9。`);
    imgIdx++;
  }

  // 角色参考
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

  // 场景参考
  if (sceneRefPath && fs.existsSync(sceneRefPath)) {
    const label = `@图片 ${imgIdx}`;
    labels.scene = label;
    const sceneLabel = sceneName ?? "本场景";
    lines.push(`${label} 作为场景参考（${sceneLabel}）。`);
    imgIdx++;
  }

  // 主体定义
  lines.push("");
  lines.push("【主体定义】");
  charCount = 0;
  let charImgIdx = (hasPrevLastFrame ? 1 : 0) + (hasStoryboard ? 1 : 0) + 1;
  for (const char of actingCharacters) {
    if (charCount >= MAX_CHARACTER_REFS) break;
    if (charRefMap.has(char.name)) {
      lines.push(`将 @图片 ${charImgIdx} 中的${char.detail ? char.detail.slice(0, 30) : char.name}定义为${char.name}。`);
      charImgIdx++;
      charCount++;
    }
  }
  // 超出 4 人的角色用纯文字描述
  if (actingCharacters.length > MAX_CHARACTER_REFS) {
    for (let i = MAX_CHARACTER_REFS; i < actingCharacters.length; i++) {
      const char = actingCharacters[i];
      lines.push(`${char.name}：${char.detail ?? "（无描述）"}（无参考图，仅文字描述）。`);
    }
  }

  // 场景定调
  if (sceneName) {
    lines.push("");
    lines.push("【场景定调】");
    lines.push(`场景为「${sceneName}」${labels.scene ? `，匹配 ${labels.scene} 的空间布局、光线方向和整体氛围` : ""}。`);
  }

  return { text: lines.join("\n"), labels };
}
```

- [ ] **Step 5: 新增 `buildShotSequence` 函数**

```typescript
function buildShotSequence(shots: ShotSpec[]): string {
  const lines: string[] = ["【分镜序列】"];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const idx = i + 1;

    // 运镜术语转中文
    const typeZh = CAMERA_TYPE_MAP[shot.type] ?? shot.type;
    const cameraZh = CAMERA_MOVE_MAP[shot.camera] ?? CAMERA_MOVE_MAP[shot.camera?.split(" ")[0] ?? ""] ?? shot.camera;

    // 组装：镜头 N：景别+运镜，动作描述
    const cameraPart = `${typeZh}${cameraZh}`;
    lines.push(`镜头 ${idx}：${cameraPart}，${shot.action}`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 6: 新增 `buildConstraints` 函数**

```typescript
function buildConstraints(style: string, actingCharacters: CharacterSpec[]): string {
  const lines: string[] = ["【约束条件】"];

  const charNames = actingCharacters.map(c => c.name);
  if (charNames.length > 0) {
    lines.push(`• 全程保持${charNames.join("、")}的外观一致——面部特征、服装、体型不得漂移`);
  }
  lines.push("• 保持无字幕，避免生成任何文字或字幕");
  lines.push("• 不要生成水印或 Logo");
  lines.push("• 不要引入未定义的角色");
  if (actingCharacters.length > 1) {
    lines.push("• 视频全程禁止出现外形、着装完全一致的人物（禁止双胞胎效果）");
  }
  lines.push("• 人物面部稳定不变形，动作自然流畅，无卡顿无闪烁");

  // 风格约束
  const styleConstraint = STYLE_CONSTRAINTS[style] ?? STYLE_CONSTRAINTS["cinematic"];
  lines.push(`• 风格：${styleConstraint}`);

  return lines.join("\n");
}
```

- [ ] **Step 7: 新增 `buildContinuityNoteV2` 函数**

```typescript
function buildContinuityNoteV2(
  segmentId: number,
  prevLastShot: (ShotSpec & { actNumber: number }) | undefined,
  shots: Array<ShotSpec & { actNumber: number }>,
  lastFrameLabel: string | undefined,
): string | undefined {
  if (segmentId === 1 || !prevLastShot || !lastFrameLabel) return undefined;

  const firstShot = shots[0];
  const sameScene = firstShot?.scene && prevLastShot.scene && firstShot.scene === prevLastShot.scene;

  const lines: string[] = ["【衔接要求】"];

  if (sameScene) {
    lines.push(`${lastFrameLabel} 是上一段的结尾画面。开场必须与此画面完全一致：`);
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
```

- [ ] **Step 8: 重写 `runPromptsStage` 主循环**

替换 `runPromptsStage` 函数中 `for (const act of screenplay.acts)` 循环内的逻辑：

```typescript
for (const act of screenplay.acts) {
  segmentId++;

  const primarySceneId = getPrimaryScene(act.shots);
  const sceneRefPath = primarySceneId ? sceneRefMap.get(primarySceneId) : undefined;
  const sceneName = primarySceneId ? sceneSpecMap.get(primarySceneId)?.name : undefined;

  const prevLastFramePath = segmentId > 1
    ? path.join(framesDir, `segment-${segmentId - 1}-last.png`)
    : undefined;

  const storyboardRawPath = path.join(projectDir, "storyboard", `act-${act.act}-raw.png`);

  const shotsWithAct = act.shots.map((s) => ({ ...s, actNumber: act.act }));

  const actingCharacters = getActingCharacters(act.shots, screenplay.characters);

  const transitionStrategy = determineTransitionStrategy(
    shotsWithAct, segmentId, transitionHintMap, prevLastShot,
  );

  const hasPrevLastFrame = prevLastFramePath !== undefined && fs.existsSync(prevLastFramePath);
  const hasStoryboard = fs.existsSync(storyboardRawPath);

  // 组装参考图
  const referenceImageRefs = assembleReferenceImages(
    actingCharacters, charRefMap, prevLastFramePath,
    hasStoryboard ? storyboardRawPath : undefined, sceneRefPath,
  );

  // 构建各段
  const { text: materialDesc, labels } = buildMaterialDesc(
    act, segmentId, screenplay.acts.length,
    actingCharacters, charRefMap,
    hasPrevLastFrame, hasStoryboard, sceneRefPath, sceneName,
  );

  const continuityNote = buildContinuityNoteV2(
    segmentId, prevLastShot, shotsWithAct, labels.lastFrame,
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
  artifacts[`prompts/segment-${segmentId}.json`] = `prompts/segment-${segmentId}.json`;

  prevLastShot = shotsWithAct[shotsWithAct.length - 1];
}
```

- [ ] **Step 9: 移除不再使用的旧函数**

从 `3-prompts.ts` 中删除以下函数（已被新函数替代）：
- `buildReferenceDescription`
- `buildIntent`
- `buildRules`
- `buildCameraNotes`
- `buildSoundDesign`
- `buildNegatives`
- `buildEndState`
- `buildContinuityNote`

- [ ] **Step 10: 运行 typecheck**

Run: `cd /Users/vincent/work/ai-films && pnpm run typecheck`
Expected: 无报错

- [ ] **Step 11: 运行 lint 并修复**

Run: `cd /Users/vincent/work/ai-films && pnpm run format`

- [ ] **Step 12: Commit**

```bash
git add src/prompts/video-shot.ts src/pipeline/stages/3-prompts.ts
git commit -m "feat: stage 3 prompt 重构——@ 语法、中文分镜格式、去除时间戳、引入分镜图"
```

---

### Task 4: Stage 4 Last-Frame 注入适配

**Files:**
- Modify: `src/pipeline/stages/4-video-gen.ts`

**目标**：Stage 4 运行时注入 last-frame 时，输出新的 @ 语法格式而非旧的 `[ImageN]` 格式。

- [ ] **Step 1: 重写 last-frame 注入逻辑**

替换 `4-video-gen.ts` 中 `// h. Inject last frame` 块（约 line 203-298）：

```typescript
// h. Inject last frame + continuity into next segment's prompt (new format)
const nextPromptPath = path.join(promptsDir, `segment-${segmentId + 1}.json`);
if (fs.existsSync(nextPromptPath)) {
  const nextConfig: VideoPromptConfig = JSON.parse(
    fs.readFileSync(nextPromptPath, "utf-8"),
  );
  const alreadyHas = nextConfig.referenceImageRefs?.some((r) =>
    r.endsWith(`segment-${segmentId}-last.png`),
  );
  if (!alreadyHas) {
    // 1. Prepend last frame to referenceImageRefs
    const existingRefs = nextConfig.referenceImageRefs ?? [];
    nextConfig.referenceImageRefs = [lastFramePath, ...existingRefs];

    // 2. Rebuild materialDesc — 在素材说明开头插入衔接参考
    if (nextConfig.materialDesc) {
      const lastFrameLabel = "@图片 1";
      // 将已有的 @图片 N 索引全部 +1
      const shiftedMaterial = nextConfig.materialDesc.replace(
        /@图片 (\d+)/g,
        (_, n) => `@图片 ${Number(n) + 1}`,
      );
      // 在【素材说明】后插入衔接参考行
      const insertLine = `${lastFrameLabel} 作为衔接参考，这是上一段的最后一帧。`;
      nextConfig.materialDesc = shiftedMaterial.replace(
        "【素材说明】\n",
        `【素材说明】\n${insertLine}\n`,
      );
    }

    // 3. Rebuild continuityNote with new format
    const currentLastShot = config.shots[config.shots.length - 1];
    const nextFirstShot = nextConfig.shots[0];
    const sameScene =
      currentLastShot?.scene && nextFirstShot?.scene &&
      currentLastShot.scene === nextFirstShot.scene;

    if (sameScene) {
      nextConfig.continuityNote = [
        "【衔接要求】",
        "@图片 1 是上一段的结尾画面。开场必须与此画面完全一致：",
        "• 相同背景、家具、物体、空间布局",
        "• 相同光线方向、强度和色温",
        "• 相同镜头角度和距离",
        "• 角色位置和姿态与参考图一致",
        `前段结尾动作：${currentLastShot.action}`,
      ].join("\n");
    } else {
      nextConfig.continuityNote = [
        "【衔接要求】",
        "@图片 1 是上一段的结尾画面。平滑过渡到新场景：",
        "• 保持角色外观和服装一致",
        "• 使用自然过渡（角色转身/行走，揭示新环境）",
        `前段结尾动作：${currentLastShot?.action ?? "上一场景"}`,
      ].join("\n");
    }

    // 4. Rebuild prompt and save
    const updatedPrompt = buildSeedancePrompt(nextConfig);
    fs.writeFileSync(
      nextPromptPath,
      JSON.stringify({ ...nextConfig, prompt: updatedPrompt }, null, 2),
      "utf-8",
    );
    console.log(
      `[video-gen] 已注入 segment ${segmentId} 的最后一帧到 segment ${segmentId + 1} 的提示词`,
    );
  }
}
```

- [ ] **Step 2: 移除旧注入逻辑中不再需要的变量**

删除 stage 4 中的 `sceneRefMap`、`sceneSpecMap` 相关查找逻辑（如果它们只用于旧格式的 `[Image2]` 场景注入）。检查是否有其他引用后再删除。

- [ ] **Step 3: 运行 typecheck**

Run: `cd /Users/vincent/work/ai-films && pnpm run typecheck`
Expected: 无报错

- [ ] **Step 4: 运行 lint 并修复**

Run: `cd /Users/vincent/work/ai-films && pnpm run format`

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/stages/4-video-gen.ts
git commit -m "feat: stage 4 last-frame 注入适配新的 @ 语法格式"
```

---

### Task 5: 集成验证

**Files:** None (verification only)

- [ ] **Step 1: 全量 typecheck**

Run: `cd /Users/vincent/work/ai-films && pnpm run typecheck`
Expected: 无报错

- [ ] **Step 2: lint 检查**

Run: `cd /Users/vincent/work/ai-films && pnpm run lint`
Expected: 无报错

- [ ] **Step 3: 试运行 dry-run（如可行）**

Run: `cd /Users/vincent/work/ai-films && pnpm run dev -- generate --dry-run`（如有此选项）
验证 prompt JSON 输出格式正确。

- [ ] **Step 4: 检查生成的 prompt 样例**

手动查看一个已有项目的 `prompts/segment-1.json`，确认：
- 包含 `materialDesc` 字段，使用 `@图片 N` 语法
- 包含 `shotSequence` 字段，使用 `镜头 N：` 格式，无时间戳
- 包含 `constraints` 字段，中文约束
- `prompt` 字段是以上各段拼接的结果
