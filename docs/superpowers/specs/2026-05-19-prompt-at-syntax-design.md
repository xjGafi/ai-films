# Prompt 模板官方规范对齐设计

## 背景

对照 [Seedance 2.0 官方提示词指南](https://www.volcengine.com/docs/82379/2222480)（2026.05.15 更新）和技术顾问建议，当前项目的 prompt 模板存在多个与官方规范不一致的问题，可能影响生成质量。

主要问题：
1. 使用 `[ImageN]` 标记而非官方 `@图片 N` 语法 → 模型无法正确关联素材
2. 镜头标注了精确时间戳 `(0:00-0:03)` → 官方明确说"强行限制时长可能导致生成结果异常"
3. prompt 全英文 → 官方示例全中文，模型对中文指令响应更好
4. 缺少主体定义绑定 → 多角色时模型易混淆
5. 分镜图已生成但未使用 → 浪费了构图参考能力

## 目标

将 prompt 模板全面对齐官方提示词指南，涵盖：
1. `@图片 N` / `@视频 N` 参考语法 + 功能角色声明
2. 去除精确时间戳，改用 `镜头 N` 分镜格式
3. 镜头描述按官方推荐结构重组（运镜 → 动作 → 空间 → 音频）
4. 新增主体定义绑定
5. 引入分镜图作为参考素材
6. 采用官方特殊符号规范（音效/台词/音乐）
7. prompt 语言从英文切换为中文

## 改动范围

| 文件 | 改动类型 |
|------|----------|
| `src/prompts/screenplay.ts` | 改造：system prompt 改为中文，要求 LLM 输出中文叙事内容 |
| `src/pipeline/stages/3-prompts.ts` | 重构：参考图组装、描述生成、镜头格式、规则文本 |
| `src/prompts/video-shot.ts` | 重构：模板结构从英文多段式改为中文分镜式 |
| `src/pipeline/stages/4-video-gen.ts` | 适配：last-frame 注入逻辑输出新格式 |
| `src/types.ts` | 小改：`VideoPromptConfig` 新增字段 |

---

## 设计细节

### 1. 参考图组装（`assembleReferenceImages`）

按优先级依次放入 `reference_images` 数组：

| 索引位置 | 素材 | 功能角色 | 条件 |
|----------|------|----------|------|
| 1 | 上一段最后一帧 | 衔接参考 | segment ≥ 2 且文件存在 |
| 2 | 完整 3×3 分镜图 | 分镜参考 | `storyboard/act-{N}-raw.png` 存在 |
| 3..N | 角色参考图 | 角色锚定 | 本段出场角色，soft limit ≤ 4 |
| 末位 | 场景参考图 | 场景定调 | 场景图存在时加入 |

**角色数量策略**：官方文档明确警告"参考人物超过 4 人时，模型输出稳定性下降"。当出场角色 > 4 人时，只保留前 4 个（按出场频次排序），并在 prompt 中用文字描述其余角色。

**安全上限**：`MAX_REFERENCE_IMAGES = 10`。

### 2. 主体定义与参考描述（`buildReferenceDescription`）

新增**主体定义段**，按官方推荐格式绑定角色与素材：

```
【素材说明】
@图片 1 作为衔接参考，这是上一段的最后一帧。
@图片 2 作为分镜参考，这是本段9个镜头的3×3分镜图，各格构图按从左到右、从上到下顺序对应镜头 1–9。
@图片 3 作为角色参考，@图片 4 作为角色参考，@图片 5 作为场景参考。

【主体定义】
将 @图片 3 中穿白大褂、短发的中年男性定义为小明。
将 @图片 4 中扎马尾、穿护士服的年轻女性定义为小红。

【场景定调】
场景为"诊室"，匹配 @图片 5 的空间布局、墙面颜色、光线方向。
```

**返回结构**：`buildReferenceDescription` 返回 `{ text: string; labels: Map<string, string> }`，其中 labels 存储 `{ lastFrame: "@图片 1", storyboard: "@图片 2", characters: ["@图片 3", "@图片 4"], scene: "@图片 5" }` 等标记供后续引用。

### 3. 镜头格式重构（核心改动）

#### 当前格式（有问题）：
```
[Row 1]
Shot 1 (0:00-0:03) [MS] • tracking — Title
  action text
Shot 2 (0:03-0:05) [CU] • static — Title
  action text
```

#### 新格式（对齐官方）：
```
镜头 1：中景跟拍，小明从走廊走进诊室，步伐平稳，表情严肃。小红站在柜台前整理病历。
镜头 2：近景固定，小明坐下，双手交叉放在桌上，微微前倾，表情关切地看向对面。<听诊器碰撞桌面的声响>
镜头 3：特写缓推，小明的手指在X光片上滑过，指向病灶区域。
```

每个镜头按官方推荐顺序：
- **运镜方式**（一个镜头只用一种）
- **主体动作与表情**（肢体细化 + 程度量化）
- **位置/空间变化**
- **音频信息**（用官方符号）

#### 关键变化：
- 去除 `(0:00-0:03)` 精确时间 → 改为"不强制限制时长，让模型根据剧情自然生成节奏"
- 去除 `[Row N]` 分组 → 用 `镜头 N` 平铺
- 去除英文 shot type/camera 标签 → 融入中文描述开头
- 一个镜头只指定一种运镜

### 4. 特殊符号规范

对齐官方定义：

| 信息类型 | 符号 | 示例 |
|----------|------|------|
| 音乐 | `（）` | （背景中播放着轻柔的钢琴曲） |
| 音效 | `<>` | <门把手转动的金属声> |
| 台词 | `{}` | {医生，我这个严重吗？} |
| 字幕 | `【】` | 【第一幕：问诊】|

当前 prompt 的 `SOUND DESIGN` 段改为用这些符号内嵌到各镜头描述中（官方格式是音频信息跟在镜头描述末尾）。

### 5. prompt 整体结构重组

#### 当前结构（英文多段式）：
```
1. INTENT
2. REFERENCE DESCRIPTION
3. RULES
4. CONTINUITY NOTE
5. STYLE
6. SHOT SEQUENCE
7. CAMERA DIRECTION
8. SOUND DESIGN
9. NEGATIVE INSTRUCTIONS
10. END STATE
11. Footer
```

#### 新结构（中文分镜式，对齐官方进阶公式）：
```
1. 【素材说明】— @ 语法声明各素材角色
2. 【主体定义】— 绑定角色与参考图
3. 【场景定调】— 场景 + 风格 + 画质
4. 【衔接要求】— 视觉连续性说明（segment 2+ 才有）
5. 【分镜序列】— 镜头 1..N，每个镜头融合运镜+动作+音频
6. 【约束条件】— 负面指令 + 画质/风格约束
```

**精简原则**：
- 去除独立的 CAMERA DIRECTION 段（融入各镜头描述）
- 去除独立的 SOUND DESIGN 段（融入各镜头描述 + 符号标注）
- 去除 END STATE 段（最后一个镜头自然表达结束状态）
- INTENT 信息合并到素材说明开头
- RULES 精简后归入约束条件

### 6. `VideoPromptConfig` 类型调整

```ts
export interface VideoPromptConfig {
  segmentId: number;
  mode: VideoGenMode;
  transitionStrategy: TransitionStrategy;
  // 新结构
  materialDesc: string;        // 【素材说明】+【主体定义】+【场景定调】
  continuityNote?: string;     // 【衔接要求】
  shotSequence: string;        // 【分镜序列】
  constraints: string;         // 【约束条件】
  // 保留
  style: string;
  totalDuration: number;
  referenceImageRefs?: string[];
  seed: number;
}
```

旧字段（`intent`, `referenceDesc`, `rules`, `shots`, `cameraNotes`, `soundDesign`, `negatives`, `endState`）全部废弃，用新字段替代。

### 7. `buildSeedancePrompt` 重写

从多段式拼接改为简洁的分镜式拼接：

```ts
export function buildSeedancePrompt(config: VideoPromptConfig): string {
  const parts: string[] = [];
  parts.push(config.materialDesc);
  if (config.continuityNote) parts.push(config.continuityNote);
  parts.push(config.shotSequence);
  parts.push(config.constraints);
  return parts.join("\n\n");
}
```

### 8. Stage 4 兼容性

Stage 4 运行时注入 last-frame 时，需要：
- 把新帧路径 prepend 到 `referenceImageRefs`
- 重写 `materialDesc` 中的素材说明，将 last-frame 加为 `@图片 1` 并将其余索引 +1
- 更新 `continuityNote` 为新格式

---

## 镜头描述生成逻辑

### 输入数据（来自 screenplay JSON 的 ShotSpec）

```ts
interface ShotSpec {
  id: number;
  time: string;      // "0:00-0:03" — 仍保留在数据层，只是 prompt 不输出
  type?: string;     // "MS", "CU", "WS" 等
  camera?: string;   // "tracking", "static", "push in" 等
  action: string;    // 动作描述
  title?: string;
  scene?: string;
  emotion?: string;
  pace?: string;
  physics?: string;
}
```

### 转换规则

每个 ShotSpec 转为一行镜头描述：

```ts
function buildShotLine(shot: ShotSpec, idx: number, characters: CharacterSpec[]): string {
  // 1. 运镜：type + camera → 中文运镜术语
  // 2. 动作：action 保留（可能需要中文化或保留原文）
  // 3. 音效/台词：从 action 中提取或从 emotion 推导
  return `镜头 ${idx}：${cameraDesc}，${actionDesc}。${audioDesc}`;
}
```

**运镜术语映射表**：

| 英文 | 中文 |
|------|------|
| MS / medium shot | 中景 |
| CU / close-up | 近景/特写 |
| WS / wide shot | 全景 |
| ECU / extreme close-up | 大特写 |
| tracking | 跟拍 |
| static | 固定镜头 |
| push in | 缓推 |
| pull back | 拉远 |
| pan | 横摇 |
| tilt | 俯仰 |
| handheld | 手持 |

### action 文本处理

**Stage 0 同步改为输出中文**：修改 `src/prompts/screenplay.ts` 中的 system prompt，明确要求 LLM 用中文生成叙事内容。

保留英文的字段（枚举值/专业术语）：
- `shot.type` — "MS", "CU", "WS" 等（英文缩写，stage 3 映射为中文运镜术语）
- `shot.camera` — "tracking", "static", "push in"（英文术语，stage 3 映射为中文）
- `shot.pace` — "slow" / "medium" / "fast"（枚举值）
- `shot.emotion` — 保留英文情绪词（内部使用，不输出到 Seedance prompt）

改为中文输出的字段：
- `shot.action` — 动作描述（直接输出到 Seedance prompt 的镜头序列中）
- `shot.title` — 镜头标题
- `act.name` — 幕名
- `scene.name` / `scene.description` — 场景名称和描述
- `character.detail` — 角色外观描述（用于主体定义段）

这样 stage 3 生成 Seedance prompt 时，action 文本已经是中文，无需翻译或中英混合。

---

## 约束条件段

```
【约束条件】
• 保持无字幕，避免生成任何文字或字幕
• 不要生成水印或 Logo
• 不要引入未定义的角色
• 视频全程禁止出现外形、着装完全一致的人物（禁止双胞胎效果）
• 人物面部稳定不变形，动作自然流畅，无卡顿无闪烁
• {风格约束}
```

风格约束根据 `config.style` 生成：
- cinematic → "电影质感，高清，色彩自然，光影柔和，35mm 胶片颗粒感"
- anime → "2D 日漫风格，赛璐珞着色，动态夸张"
- 3d-pixar → "3D 皮克斯动画风格，明亮饱和色彩，卡通夸张表情"

---

## Segment 1 vs Segment 2+ 的差异

| | Segment 1 | Segment 2+ |
|---|---|---|
| 衔接参考 | 无 | @图片 1 = last frame |
| 分镜参考 | @图片 1 | @图片 2 |
| 衔接要求段 | 无 | 有（同场景/跨场景） |
| 约束条件 | 标准 | 标准 + "开场必须与衔接参考画面一致" |

---

## 不改的部分

- `src/providers/volcengine.ts` — API 调用逻辑不变
- `src/pipeline/stages/0-screenplay.ts` — 调用逻辑不变（只改 prompt 模板内容）
- `src/types.ts` 中的 `ShotSpec` 接口 — 字段名和类型不变，只是值从英文变中文
- Stage 1 (characters) — 不涉及 prompt 改动
- Stage 2 (storyboard) — 已生成 `act-N-raw.png`，无需改动
- Stage 5/6 (transitions/assembly) — 不涉及 prompt

## 预期效果

- 对齐官方最佳实践，去除已知的"损害质量"因素（精确时间戳）
- @ 语法 + 主体绑定 → 模型明确识别素材角色
- 分镜图引入 → 构图更贴合设计稿
- 中文分镜格式 → 模型理解力更强
- 角色数量控制 → 减少 ID 漂移和双胞胎问题
- 符号规范 → 音效/台词生成更精准
