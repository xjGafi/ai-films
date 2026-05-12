# AI 长视频生成产品：完整技术参考

> 基于 GPT Image 2 + Seedance 2.0 API 构建自动化 AI 影片生产流水线

---

## 目录

1. [GPT Image 2 API 详解](#1-gpt-image-2-api-详解)
2. [Seedance 2.0 API 详解](#2-seedance-20-api-详解)
3. [Prompt 工程手册](#3-prompt-工程手册)
4. [视频流水线自动化](#4-视频流水线自动化)
5. [开源项目参考](#5-开源项目参考)
6. [架构设计建议](#6-架构设计建议)
7. [三大核心难题：角色统一、剧情完整、无缝衔接](#7-三大核心难题角色统一剧情完整无缝衔接)

---

## 1. GPT Image 2 API 详解

### 1.1 可用模型

| 模型 | 特点 |
|------|------|
| `gpt-image-2` / `gpt-image-2-2026-04-21` | 最新一代，支持任意分辨率(最高4K) |
| `gpt-image-1.5` | 编辑默认模型，支持透明背景 |
| `gpt-image-1` | 初代，支持透明背景 |
| `gpt-image-1-mini` | 低成本变体 |

### 1.2 API 端点

#### 图片生成 `images.generate()`

```python
from openai import OpenAI
import base64

client = OpenAI()

result = client.images.generate(
    model="gpt-image-1",
    prompt="12-panel cinematic storyboard...",
    size="1536x1024",       # 16:9 近似
    quality="high",         # low / medium / high / auto
    output_format="png",    # png / jpeg / webp
    n=1,                    # 1-10 张
    moderation="low",       # low = 更宽松的内容审核
)

image_bytes = base64.b64decode(result.data[0].b64_json)
with open("output.png", "wb") as f:
    f.write(image_bytes)
```

**参数说明：**

| 参数 | 值 | 说明 |
|------|-----|------|
| `model` | 见上表 | |
| `prompt` | string | 最大 32,000 字符 |
| `size` | `1024x1024`, `1536x1024`, `1024x1536`, `auto` | gpt-image-2 支持任意尺寸(需被16整除，宽高比1:3~3:1，最大3840x2160) |
| `quality` | `low` / `medium` / `high` / `auto` | 影响 token 消耗和细节程度 |
| `n` | 1-10 | 单次生成数量 |
| `output_format` | `png` / `jpeg` / `webp` | |
| `output_compression` | 0-100 | 仅 jpeg/webp |
| `background` | `transparent` / `opaque` / `auto` | gpt-image-1/1.5 支持透明，gpt-image-2 不支持 |
| `moderation` | `low` / `auto` | `low` 对影视内容更宽容 |

**注意：GPT Image 模型只返回 base64，不返回 URL。**

#### 图片编辑 `images.edit()` — 核心能力

这是实现**多图输入、角色一致性、场景合成**的关键端点。

```python
result = client.images.edit(
    model="gpt-image-1",
    image=[
        open("character_ref.png", "rb"),   # 最多 16 张
        open("storyboard_panel.png", "rb"),
    ],
    prompt="Place the character from image 1 into the scene from image 2...",
    input_fidelity="high",  # 关键：保留面部和细节
    quality="high",
    size="1536x1024"
)
```

| 参数 | 值 | 说明 |
|------|-----|------|
| `image` | 单个文件 或 最多 **16 张**图片数组 | png/webp/jpg，每张 <50MB |
| `mask` | PNG (alpha通道) | 透明区域表示需要编辑的部分 |
| `input_fidelity` | `high` / `low` | **`high` 是保持角色一致性的关键** |
| `prompt` | string | 最大 32,000 字符 |

**`input_fidelity="high"` 要点：**
- 数组中第一张图获得最高的细节保留度
- 面部特征保留效果显著提升
- 消耗更多 input tokens
- `gpt-image-1-mini` 不支持此参数

### 1.3 多图合成技巧

当需要合并多张人脸参考时，官方建议先拼合为一张图：

```python
from PIL import Image
import io

def combine_references_side_by_side(paths: list) -> io.BytesIO:
    images = [Image.open(p).convert("RGBA") for p in paths]
    target_h = images[0].height
    resized = []
    for img in images:
        scale = target_h / float(img.height)
        new_w = int(round(img.width * scale))
        resized.append(img.resize((new_w, target_h), Image.LANCZOS))

    total_w = sum(img.width for img in resized)
    canvas = Image.new("RGBA", (total_w, target_h), (255, 255, 255, 255))
    x = 0
    for img in resized:
        canvas.paste(img, (x, 0), img)
        x += img.width

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    buf.seek(0)
    return buf
```

### 1.4 定价参考

- 基于 token 计费（类似文本模型）
- 大约：低质量 $0.02/张，中质量 $0.07/张，高质量 $0.19/张 (1024x1024)
- `input_fidelity="high"` 会显著增加 input token 消耗
- 具体费率以 OpenAI 控制台为准

---

## 2. Seedance 2.0 API 详解

### 2.1 API 接入方式

| 平台 | 模型 ID | 特点 |
|------|---------|------|
| **Replicate** | `bytedance/seedance-2.0` | 最简单接入，按运行计费 |
| **Higgsfield AI** | `bytedance/seedance/v1/pro/image-to-video` | SDK+REST，信用点计费 |
| **火山引擎** | 即梦AI API | 需中国企业注册 |

### 2.2 完整参数表 (Replicate)

| 参数 | 类型 | 默认值 | 约束 | 说明 |
|------|------|--------|------|------|
| `prompt` | string | **必填** | - | 视频描述 |
| `image` | URI | null | 与 reference_images 互斥 | 首帧图片 (I2V) |
| `last_frame_image` | URI | null | 需同时设置 image | 末帧控制图片 |
| `reference_images` | URI[] | [] | 最多 9 张；与 image/last_frame_image 互斥 | 角色/风格/场景参考 |
| `reference_videos` | URI[] | [] | 最多 3 个，总时长 ≤15s | 动作迁移/风格参考 |
| `reference_audios` | URI[] | [] | 最多 3 个，总时长 ≤15s | 音频驱动/口型同步 |
| `duration` | int | 5 | -1 ~ 15 | 秒数，-1=自动判断 |
| `resolution` | enum | "720p" | 480p / 720p / 1080p | |
| `aspect_ratio` | enum | "16:9" | 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / 9:21 / adaptive | |
| `generate_audio` | bool | true | - | 生成同步音效/对话 |
| `seed` | int | null | - | 固定种子以保持风格一致 |

**重要限制：**
- **没有** CFG scale 参数（模型内部处理）
- **没有** motion strength 参数（通过 prompt 描述运动强度）
- **没有** FPS 参数（模型自动决定）
- **没有** 独立的 negative prompt 字段（需要在 prompt 中内联写入）
- `image`/`last_frame_image` 和 `reference_images` **互斥，不能同时使用**

### 2.3 分辨率对照表

| 分辨率 | 16:9 | 4:3 | 1:1 | 3:4 | 9:16 |
|--------|------|-----|-----|-----|------|
| 480p | 864×496 | 752×560 | 640×640 | 560×752 | 496×864 |
| 720p | 1280×720 | 1112×834 | 960×960 | 834×1112 | 720×1280 |
| 1080p | 1920×1080 | - | - | - | - |

### 2.4 两种互斥的工作模式

#### 模式 A：首帧/末帧控制 (精确构图)

```python
import replicate

output = replicate.run(
    "bytedance/seedance-2.0",
    input={
        "prompt": "The character turns slowly, cinematic lighting",
        "image": "https://example.com/panel-start.png",        # 首帧
        "last_frame_image": "https://example.com/panel-end.png", # 末帧
        "duration": 5,
        "resolution": "720p",
        "aspect_ratio": "16:9",
        "seed": 42
    }
)
```

**适用场景**：需要精确控制视频起止画面，实现帧级别的无缝过渡。

#### 模式 B：多参考图模式 (角色一致性)

```python
output = replicate.run(
    "bytedance/seedance-2.0",
    input={
        "prompt": "[Image1] walks through the forest from [Image2], cinematic tracking shot. Total: 10s / 1 shot / 16:9",
        "reference_images": [
            "https://example.com/character-sheet.png",  # [Image1]
            "https://example.com/environment.png"       # [Image2]
        ],
        "duration": 10,
        "resolution": "720p",
        "aspect_ratio": "16:9",
        "seed": 42
    }
)
```

**适用场景**：需要角色在多段视频中保持外观一致，构图可以更自由。

**在 prompt 中引用**：`[Image1]`, `[Image2]`, `[Video1]`, `[Audio1]` 等。

### 2.5 Higgsfield SDK 用法

```python
import higgsfield_client

result = higgsfield_client.subscribe(
    'bytedance/seedance/v1/pro/image-to-video',
    arguments={
        'image_url': 'https://example.com/storyboard.png',
        'prompt': 'Smooth cinematic pan, golden hour lighting',
        'duration': 5
    }
)
print(result['video']['url'])
```

REST API:
```bash
curl -X POST "https://platform.higgsfield.ai/bytedance/seedance/v1/pro/image-to-video" \
  -H "Authorization: Key YOUR_KEY:YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/frame.png",
    "prompt": "Camera slowly pans right revealing the landscape",
    "duration": 15
  }'
```

### 2.6 性能与定价

- 7 秒 720p 视频约需 ~115 秒生成
- 15 秒片段预计 3-4 分钟
- Replicate：特殊定价，约 $0.10-0.50/次（估算）
- Higgsfield：信用点系统，有 30% 促销

---

## 3. Prompt 工程手册

### 3.1 分镜板生成 Prompt (GPT Image 2)

#### 基础分镜生成

```
Generate a 12-panel cinematic storyboard in a 4-column × 3-row grid layout.
Each panel has a small text label below describing the shot.

Story: [一句话故事描述]

Characters (maintain exact appearance across all panels):
- [角色1描述]
- [角色2描述]

Style: cinematic, photorealistic, 16:9 framing per panel.
Include panel numbers (1-12) and brief text description under each panel.
```

#### 进阶分镜：色彩标注系统（推荐）

来自社区实践：分镜图本身保持**黑白素描**，用不同颜色的标注分层，防止 Seedance 将标注误读为画面内容。

```
Create a [主题] storyboard. Use reference image for the character.

16:9 storyboard sheet, 12 cinematic panels. The actual storyboard drawings
must be black and white only: rough pencil lines, minimal detail, fast gesture
drawing energy, simple anatomy construction and strong silhouette readability.

[场景和动作描述...]

Every panel must contain visible motion and strong body momentum.
Avoid static standing poses.

Annotation color system:
- red arrows = body movement direction
- blue arrows = camera movement
- green marks = framing / composition notes
- orange marks = lighting direction
- purple marks = vocal / emotional emphasis
- black text = short lens notes and panel labels

No timestamps.
```

#### 进阶分镜：好莱坞级制作板

适合需要角色设计、运镜标注、色彩方案一体化输出的场景。

```
A masterfully crafted cinematic storyboard page designed like a real
Hollywood feature film pre-production board.

Rendered on textured cream/off-white storyboard paper with authentic graphite
smudges, rough production pencil marks, red framing lines, blue movement
arrows, timing scribbles, and cinematic annotation layers.

TITLE handwritten at top left: "[项目名] – [序列名]"
"OPENING SEQUENCE – SHOTS 1.1.1 TO 1.1.12"

Professional storyboard layout: 12 frames in a clean 4x3 grid occupying
the left two-thirds of the page. Every panel framed with thin rough red
rectangles labeled: "CAMERA / FRAMING"

[角色描述 — 包含外观、运动风格比喻]
[每个 SHOT 的详细描述 — 编号 + 镜头类型 + 情感标题 + 动作]

RIGHT-SIDE CHARACTER DESIGN SECTION: "CHARACTER DESIGN & CASTING"
Contains: expression studies, motion studies, poses, hand sketches,
silhouette tests, dramatic face angles, cinematic render portraits
[角色1详细设计 — 包含 Casting Reference: 类比演员 Age X Height X]
[角色2详细设计]

BOTTOM STORYBOARD NOTES:
"CAMERA / STORY NOTES" [运镜策略]
"SOUNDTRACK / MUSIC NOTES" [节奏设计]
"COLOR PALETTE" Crosshatched crayon/pencil swatches:
- [颜色1] – [用途]
- [颜色2] – [用途]
...
```

#### 角色参考表生成

**基础版（动画用）**：
```
Generate a professional character reference sheet / model sheet for animation.

Character: [角色名]
- [身高、体型]
- [面部特征]
- [服装详细描述]

Layout:
- Front view (full body, neutral pose)
- 3/4 view (full body, slight right turn)
- Side view / profile (full body)
- Back view (full body)
- Head close-ups: front, 3/4, profile
- Key expressions: neutral, angry, surprised

White background. Clean with flat color fills.
Label each view. Include height reference bar.
```

**进阶版（Pixar 3D / 海报级）**：
```
Create a Pixar 3D style character design sheet. Clean white background.
[N] characters presented side by side with a clean dividing line.
Bold brushstroke-style title at the top: [标题]

[角色名]
Underneath: "[一句话性格/处境概括]"
Three poses in a horizontal row:
- [姿态1 — 核心状态]
- [姿态2 — 过渡状态]
- [姿态3 — 极端状态]

One large hero portrait above the poses — [详细外观描述].

Two stat bars beneath:
- [属性A] ████░░░░░░ [状态]
- [属性B] ░░░░░░████ [状态]

BOTTOM STRIP — full width:
Five close-up detail shots in a row: [细节1] · [细节2] · [细节3] · ...

STYLE NOTES:
[渲染风格]. [角色1色彩方案]. [角色2色彩方案].
Every expression pushed to the maximum.
This should feel like a movie poster and a character sheet at the same time.
```

#### 扩展分镜（续写故事）

```
Generate the next page of the storyboard from [image reference],
continuing the story with 12 panels using the uploaded character references.

The story continues: [新的剧情方向]

Maintain exact character appearances from the reference sheets.
Same style and panel layout as the previous page.
```

---

### 3.2 Seedance 2.0 视频 Prompt

#### 最佳 Prompt 结构（综合社区实践）

```
[总领意图 — Keyword & Overall Intent]

Use the attached [X] as the exact visual reference for [用途].

RULES:
• [不可违反的约束1]
• [不可违反的约束2]
• [叙事约束 — e.g. "Gerald loses. Kevin wins. That is non-negotiable."]

IMPORTANT:
[跨段声明 / 执行边界 — e.g. "Animate ONLY PART 1"]
Follow the sequence exactly. Do not skip, reorder, merge, or invent steps.

STYLE:
[视觉风格完整声明]

TIMING:
[总时长] total. [N] shots. About [X]s per shot.

SHOT SEQUENCE:
Shot 1 (0:00-0:03) [镜头类型缩写] • [摄像机运动] — [标题]
[动作描述. 物理约束标签.]

Shot 2 (0:03-0:05) [CU] • [Rapid panning] — [标题]
[动作描述.]

...

CAMERA DIRECTION:
• [镜头1的摄影策略]
• [镜头2的摄影策略]
• ...

SOUND DESIGN:
[按时间顺序的音效描述. 不要用列表，用叙事性描述.]

NEGATIVE INSTRUCTIONS:
Do not [禁止事项1].
Do not [禁止事项2].
Do not add text overlays / music / extra characters.
Do not skip steps.

END STATE:
[末尾画面状态的精确描述，为下一段做铺垫]

Total: [X]s / [N] shots / 16:9
```

#### Shot 密度选择

| 节奏类型 | 密度 | 适用场景 |
|----------|------|---------|
| 慢节奏/抒情 | 3-4 shots / 15s (约 4s/shot) | 风景、情感、对话 |
| 标准叙事 | 6 shots / 15s (约 2.5s/shot) | 教程、剧情推进 |
| 快节奏/动作 | 10 shots / 15s (约 1.5s/shot) | 格斗、蒙太奇、时尚走秀 |
| 高能量 | 10 shots / 15s 但用非整数时间 | 需要"每个beat作为快速快照"的场景 |

#### Shot 描述格式

**标准格式**（适合大多数场景）：
```
0:00–0:03 — The Setup. Wide bright establishing shot of the scene.
[具体动作描述.]
```

**专业格式**（适合高密度/复杂场景）：
```
Shot 1 (0-1.5s) Medium Shot (MS) • Camera Movement: Rapid zoom
• Core Action: [动作描述]. [物理约束标签: Rigid body collisions.]
```

**镜头类型缩写**：
- `ECU` = Extreme Close-Up
- `CU` = Close-Up
- `MS` = Medium Shot
- `EWS` = Extreme Wide Shot
- `Macro` = 微距

#### 摄像机运动关键词

| 效果 | 关键词 |
|------|--------|
| 平移 | `smooth cinematic camera pan from left to right` |
| 环绕 | `full 360-degree orbit`, `camera orbits left at constant distance` |
| 推进 | `camera slowly pushing in through the trees` |
| 急推 | `rapid zoom`, `rapid close-up` |
| 急拉 | `rapid pull-out` |
| FPV | `FPV arm movement cresting over an edge` |
| 手持 | `hyper-chaotic handheld motion, completely unstabilized`, `violent camera shake` |
| 速度变化 | `RAMPS TO SLOW MOTION ... SNAPS BACK` |
| 低角度 | `extreme low angle looking up` |
| 跟踪 | `camera follows subject, tracking shot`, `camera tracks the models as they march` |
| 甩镜 | `camera whip-pans with the dodge` |
| 环绕下方 | `camera circles beneath the fabric` |
| 固定 | `wide static locked` |

#### 风格关键词模板

**写实电影**：
```
cinematic lighting, photorealistic, 35mm film quality, ARRI ALEXA aesthetic,
heavy film grain, noticeable focus breathing, motion blur on fast actions,
halation on highlights, soft highlight rolloff, slightly desaturated tones
```

**Pixar 3D 动画**：
```
Pixar 3D vivid animation. Bright saturated colors throughout.
Expressions pushed to maximum Pixar exaggeration.
```

**动漫**：
```
full-color 2D anime, cel shading, rough impact lines, colored debris and dust.
```

**超写实时尚**：
```
Hyperrealism, ultra-detailed textures: [材质细节], wild camera movement,
realistic physics dominate all action.
```

#### 物理约束标签（提升运动真实感）

在 shot 描述末尾添加物理约束，帮助模型理解运动逻辑：

```
Rigid body collisions.
Fluid movement, realistic human behavior.
Complex fabric simulation, volumetric smoke flow.
Realistic conservation of momentum.
Particle collisions and realistic physics.
Grounded interaction, the perfect weight and balance.
```

#### 内联负面提示（无独立参数）

Seedance 没有 negative prompt 字段，必须写在正文中：
```
No 3D, no cartoon, no VFX, no stabilization.
No cuts, no zoom changes, natural head movement only.
```

#### VFX / SFX / 对话

**VFX 内联语法**：
```
[VFX: branching electric circuits pulsing with white-blue current]
```

**SFX 声效行**（推荐作为独立 Sound Design 段落）：
```
Sound design:
Peaceful birdsong and light breeze opening. Silence when character appears.
Impact thuds, cloth snaps, sliding shoes. Bass hit on final strike.
Gentle ambience returns. Fade out.
```

**对话触发口型同步**：
```
The character turns and says "Remember this moment."
```

**IPA 音标精确口型控制**（高级）：
```
IPA:
/aɪ muːv θruː ˈsaɪləns/
/ðə laɪt breɪks miː/
```

**FACS 面部编码系统**（高级）：
```
FACS: AU1+AU4 tension, AU5 intensity, AU25 singing mouth,
AU26 open release, AU43 exhausted blink.
```

常用 FACS Action Units：
| AU | 含义 | 效果 |
|----|------|------|
| AU1 | Inner Brow Raise | 忧虑/痛苦 |
| AU4 | Brow Lowerer | 愤怒/紧张 |
| AU5 | Upper Lid Raiser | 惊讶/紧张 |
| AU6 | Cheek Raiser | 真笑 |
| AU12 | Lip Corner Puller | 微笑 |
| AU25 | Lips Part | 说话/唱歌 |
| AU26 | Jaw Drop | 惊讶/大口 |
| AU43 | Eyes Closed | 疲惫/平静 |

---

### 3.3 无缝过渡与多段拼接

#### 基础过渡模板

```
Continuing from the previous scene. The first frame shows [描述上一段最后帧的内容].

Shot 1 (0-4s): [从该帧状态自然过渡到新动作]
Shot 2 (4-8s): [...]
Shot 3 (8-12s): [...]
Shot 4 (12-15s): [...]

Maintain character appearance exactly as shown in [Image1].
Smooth cinematic camera movement, no jump cuts.
Total: 15s / 4 shots / 16:9
```

#### 进阶过渡：CONTINUITY NOTE 模式（推荐）

当拆分为多段时（如 30s = Part1 + Part2），每段 prompt 需要包含明确的连续性声明：

**Part 1 结尾**：
```
END STATE:
End with [具体状态描述], so the next clip can continue naturally.
```

**Part 2 开头**：
```
IMPORTANT:
Animate ONLY PART 2 — the BOTTOM HALF of the storyboard.
Do not animate Part 1 in this clip.
This is the SECOND 15 SECONDS of a 30-second sequence.
Follow the sequence exactly in order from shots [N+1] to [M].
Do not skip, reorder, merge, or invent steps.

VERY IMPORTANT CONTINUITY NOTE:
This clip must feel like a direct continuation of Part 1.
Start with [Part 1 末尾状态] already present from the previous clip.
Maintain the same [角色], same [环境], same [灯光], same [道具],
and same [视觉风格].
The two clips must join seamlessly when edited together.
```

#### 镜头遮挡过渡技巧

利用物理遮挡创造自然转场（来自 @ivanka_humeniuk）：

```
Shot N: ...thick orange sand cloud completely obscuring the lens, creating
a natural matching edit. A new character suddenly emerges from the [遮挡物]...
```

可用的遮挡物：
- 沙尘/烟雾完全覆盖镜头
- 角色走到镜头正前方
- 物体向镜头飞来
- 手掌/布料遮挡
- 强光过曝

#### Prompt 复用技巧

社区发现：**分镜 prompt 和视频 prompt 可以几乎完全相同**。视频 prompt 只需在分镜 prompt 基础上加一行参考图引用：

```
Character A references @Image as the fight storyboard for choreography,
camera angles, force direction, and impact timing.

[以下内容与分镜生成 prompt 完全一致]
```

这意味着产品中可以将同一段描述同时用于：
1. 调用 GPT Image 2 生成分镜图
2. 调用 Seedance 2.0 生成视频（加上 `@Image` 引用）

---

### 3.4 分镜板到视频的引用指令

告诉 Seedance 如何"读"分镜板：

```
Use the storyboard reference @[storyboard ref] as the complete visual and
choreography source for a 15-second video.

Follow all 12 beats sequentially from left to right, top to bottom.
Do not reinterpret the actions, poses, camera angles or emotional progression.
Preserve the storyboard's shot order, movement logic, framing variety and
final pose.

Compress the full 12-beat sequence into 15 seconds. Each beat must appear
clearly as a fast motion snapshot, not as a full-length action.
Use urgent rhythm, quick cuts, match cuts and whip transitions.
No pauses until the final beat.
```

关键指令：
- `"from left to right, top to bottom"` — 明确读取顺序
- `"Do not reinterpret"` — 防止模型自由发挥
- `"Compress the full N-beat sequence into 15 seconds"` — 明确压缩
- `"Each beat must appear clearly as a fast motion snapshot"` — 定义节奏

---

## 4. 视频流水线自动化

### 4.1 帧提取

#### FFmpeg 命令

```bash
# 提取最后一帧
ffmpeg -sseof -0.1 -i input.mp4 -frames:v 1 -update 1 last_frame.png

# 提取第一帧
ffmpeg -i input.mp4 -frames:v 1 first_frame.png

# 提取指定时间点
ffmpeg -ss 00:00:14.9 -i input.mp4 -frames:v 1 frame_at_15s.png
```

#### Python (OpenCV)

```python
import cv2

def extract_last_frame(video_path: str, output_path: str) -> str:
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, total_frames - 1)
    ret, frame = cap.read()
    if ret:
        cv2.imwrite(output_path, frame)
    cap.release()
    return output_path

def extract_first_frame(video_path: str, output_path: str) -> str:
    cap = cv2.VideoCapture(video_path)
    ret, frame = cap.read()
    if ret:
        cv2.imwrite(output_path, frame)
    cap.release()
    return output_path
```

### 4.2 分镜板裁剪

```python
from PIL import Image

def crop_storyboard_to_rows(storyboard_path: str, output_dir: str) -> list:
    """将 12 格分镜板 (4×3) 裁切为 3 行"""
    img = Image.open(storyboard_path)
    width, height = img.size
    row_height = height // 3
    rows = []
    for i in range(3):
        box = (0, i * row_height, width, (i + 1) * row_height)
        row = img.crop(box)
        row.save(f"{output_dir}/row_{i+1}.png")
        rows.append(f"{output_dir}/row_{i+1}.png")
    return rows

def place_on_16x9_canvas(image_path: str, output_path: str,
                          canvas_w: int = 1920, canvas_h: int = 1080) -> str:
    """将裁剪后的行放到 16:9 黑底画布上"""
    canvas = Image.new("RGB", (canvas_w, canvas_h), (0, 0, 0))
    img = Image.open(image_path)
    ratio = min(canvas_w / img.width, canvas_h / img.height)
    new_size = (int(img.width * ratio), int(img.height * ratio))
    img_resized = img.resize(new_size, Image.Resampling.LANCZOS)
    offset = ((canvas_w - new_size[0]) // 2, (canvas_h - new_size[1]) // 2)
    canvas.paste(img_resized, offset)
    canvas.save(output_path)
    return output_path

def extract_individual_panels(storyboard_path: str, cols=4, rows=3) -> list:
    """提取所有 12 个独立面板"""
    img = Image.open(storyboard_path)
    w, h = img.size
    panel_w, panel_h = w // cols, h // rows
    panels = []
    for row in range(rows):
        for col in range(cols):
            box = (col * panel_w, row * panel_h,
                   (col + 1) * panel_w, (row + 1) * panel_h)
            panel = img.crop(box)
            panels.append(panel)
    return panels
```

### 4.3 视频拼接

#### FFmpeg 简单拼接（同编码/分辨率）

```bash
echo "file 'clip1.mp4'" > filelist.txt
echo "file 'clip2.mp4'" >> filelist.txt
echo "file 'clip3.mp4'" >> filelist.txt
ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4
```

#### FFmpeg 带交叉淡入淡出

```bash
# 两段视频，1秒交叉淡入淡出
ffmpeg -i clip1.mp4 -i clip2.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=1:offset=14[v]" \
  -map "[v]" -c:v libx264 output.mp4
```

#### Python 批量拼接

```python
import subprocess

def concatenate_clips(clip_paths: list, output_path: str,
                      crossfade: float = 0.5, clip_duration: float = 15.0):
    """使用 ffmpeg xfade 拼接多段视频"""
    if len(clip_paths) < 2:
        subprocess.run(["cp", clip_paths[0], output_path], check=True)
        return

    inputs = []
    for p in clip_paths:
        inputs.extend(["-i", p])

    filter_parts = []
    offset = clip_duration - crossfade

    # 第一对
    filter_parts.append(
        f"[0:v][1:v]xfade=transition=fade:duration={crossfade}:offset={offset}[v01]"
    )

    # 后续链式
    for i in range(2, len(clip_paths)):
        prev = f"v{i-2:02d}{i-1:02d}"
        curr = f"v{i-1:02d}{i:02d}" if i < len(clip_paths) - 1 else "vout"
        offset += clip_duration - crossfade
        filter_parts.append(
            f"[{prev}][{i}:v]xfade=transition=fade:duration={crossfade}:offset={offset}[{curr}]"
        )

    if len(clip_paths) == 2:
        filter_parts[-1] = filter_parts[-1].replace("[v01]", "[vout]")

    filter_complex = ";".join(filter_parts)

    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        output_path
    ]
    subprocess.run(cmd, check=True)
```

### 4.4 流水线状态管理

```python
import json
from pathlib import Path
from enum import Enum

class Stage(Enum):
    STORYBOARD = "storyboard"
    CHARACTER_REFS = "character_refs"
    PANEL_CROP = "panel_crop"
    VIDEO_GEN = "video_gen"
    FRAME_EXTRACT = "frame_extract"
    ASSEMBLY = "assembly"

class PipelineState:
    def __init__(self, project_dir: str):
        self.dir = Path(project_dir)
        self.file = self.dir / "pipeline_state.json"
        self.state = self._load()

    def _load(self) -> dict:
        if self.file.exists():
            return json.loads(self.file.read_text())
        return {"completed": [], "artifacts": {}, "current": None}

    def save(self):
        self.file.write_text(json.dumps(self.state, indent=2))

    def mark_complete(self, stage: Stage, artifacts: dict):
        self.state["completed"].append(stage.value)
        self.state["artifacts"][stage.value] = artifacts
        self.state["current"] = None
        self.save()

    def is_done(self, stage: Stage) -> bool:
        return stage.value in self.state["completed"]

    def get_artifacts(self, stage: Stage) -> dict:
        return self.state["artifacts"].get(stage.value, {})
```

### 4.5 限流与重试

```python
import asyncio
import time
from collections import deque

class RateLimiter:
    def __init__(self, calls_per_minute: int = 10, max_concurrent: int = 3):
        self.rpm = calls_per_minute
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.timestamps = deque()

    async def acquire(self):
        async with self.semaphore:
            now = time.time()
            while self.timestamps and now - self.timestamps[0] > 60:
                self.timestamps.popleft()
            if len(self.timestamps) >= self.rpm:
                wait = 60 - (now - self.timestamps[0])
                if wait > 0:
                    await asyncio.sleep(wait)
            self.timestamps.append(time.time())

async def call_with_retry(fn, *args, max_retries=3, **kwargs):
    for attempt in range(max_retries):
        try:
            return await fn(*args, **kwargs)
        except Exception as e:
            if "429" in str(e) or attempt == max_retries - 1:
                if attempt == max_retries - 1:
                    raise
                wait = min(60, 2 ** (attempt + 2))
                await asyncio.sleep(wait)
            else:
                await asyncio.sleep(2 ** attempt)
```

---

## 5. 开源项目参考

| 项目 | Stars | 核心架构 | 亮点 |
|------|-------|---------|------|
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) | 7.8k | 3 层 agent（决策/执行/监督），Electron | 最完整的 AI 影片制作工具 |
| [forge-film](https://github.com/F-R-L/forge-film) | 655 | DAG 调度器，多后端路由(Kling/CogVideo/Wan) | 跨模型色彩校准、单次 ffmpeg 合成 |
| [PanelFlow](https://github.com/Agions/PanelFlow) | 21 | React+Tauri，n8n 式可视化流水线 | 支持 Seedream/Seedance/Kling/Vidu |
| [ai-film-skills](https://github.com/realaman90/ai-film-skills) | 2 | Claude Code skill，Veo 3.1+Seedance 2.0 | 轻量级 assemble.py |
| [capy-video-gen-skill](https://github.com/ndpvt-web/capy-video-gen-skill) | 5 | Gemini+Veo，DeepFace 身份验证 | 300 次实验：简单 prompt > 复杂策略 |
| [story-shot-agent](https://github.com/neopen/story-shot-agent) | 61 | LangGraph 多 agent，4 层记忆 | 结构化镜头 JSON 输出 |

**关键发现（来自 capy-video-gen-skill 的 300 次实验）**：

> "简单、超详细的物理描述，每次 prompt 都重复角色特征" 比 "聪明的策略" 效果好得多。
> 面部距离指标从 0.740 降到 0.221（提升 70%）。

---

## 6. 架构设计建议

### 6.1 推荐流水线架构

```
┌─────────────────────────────────────────────────────────────┐
│                     输入层                                    │
│  故事描述 + 角色设定 + 风格偏好                                │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│          Stage 0: 编剧 (LLM — Gemini / GPT / Claude)         │
│                                                             │
│  故事大纲 → 场景拆分 → 每场景 shot list                        │
│  输出结构化 JSON: shots[], characters[], settings[]           │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Stage 1: 分镜生成 (GPT Image 2)                  │
│                                                             │
│  images.generate() → 12/16/20 格分镜板                        │
│  推荐：黑白素描 + 彩色标注系统（防视频模型误读标注）              │
│  images.edit() + input_fidelity=high → 修正重复面板            │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           Stage 2: 角色参考表 (GPT Image 2)                   │
│                                                             │
│  images.generate() → 每角色一张多角度参考表                     │
│  进阶：Pixar 级角色表（含姿态、stat bar、casting ref）         │
│  用于后续视频生成的 reference_images                           │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           Stage 3: Prompt 组装                                │
│                                                             │
│  分镜描述文本 + 角色描述 → 按最佳结构组装 Seedance prompt       │
│  关键：同一描述可同时用于分镜图生成和视频生成（复用）             │
│  加入：Rules / NEGATIVE INSTRUCTIONS / END STATE              │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│         Stage 4: 视频生成 (Seedance 2.0)                     │
│                                                             │
│  策略选择（每段视频二选一）：                                    │
│  ├─ 模式A: panel → image (首帧) + last_frame_image (末帧)    │
│  │         精确构图，帧级过渡                                  │
│  └─ 模式B: character sheet → reference_images (最多9张)       │
│            角色一致性，构图自由                                 │
│                                                             │
│  每段 15s，含完整结构化 prompt                                 │
│  每段附带 CONTINUITY NOTE + END STATE                         │
│  提取末帧 → 下一段首帧 (帧续接循环)                             │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           Stage 5: 合成 (FFmpeg)                             │
│                                                             │
│  分辨率/帧率归一化 → xfade/镜头遮挡转场 → 音频处理             │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
                    最终长视频输出
```

### 6.2 关键设计决策

| 决策点 | 推荐 | 原因 |
|--------|------|------|
| Seedance API 平台 | Replicate | 最简接入，无需企业注册 |
| 前置编剧 | 加入 Stage 0 (LLM) | 北京电影节获奖者的实践，Gemini/GPT 负责剧情逻辑 |
| 分镜风格 | 黑白素描 + 彩色标注 | 防止视频模型将标注误读为画面内容 |
| 分镜密度 | 12-20 格/页，按项目节奏调整 | 慢节奏 12 格够用，快节奏/教程需要 16-20 格 |
| 角色一致性方案 | 模式B (reference_images) | 容错率更高，不依赖精确帧匹配 |
| 帧续接方案 | 模式A (首帧/末帧) | 仅用于相邻片段过渡点 |
| 混合策略 | 主体段用模式B，段间过渡用模式A | 兼顾角色一致和过渡平滑 |
| 每段镜头数 | 按类型选择（见 §3.2 密度表） | 慢 3-4 shot, 标准 6 shot, 快 10 shot |
| Seed | 同一序列保持相同 seed | 风格一致性 |
| Prompt 复用 | 分镜描述 = 视频描述（加@引用） | 减少重复工作，社区验证有效 |
| 跨段连续性 | 每段包含 CONTINUITY NOTE + END STATE | @Dheepanratnam 20-shot 方法验证 |
| 负面指令 | 必须包含 NEGATIVE INSTRUCTIONS 段落 | 不加则模型自由发挥偏离意图 |

### 6.3 核心约束（需牢记）

1. **`image` 和 `reference_images` 互斥** — 单次调用只能选一种模式
2. **GPT Image 2 只返回 base64** — 需要先保存为文件再上传到 Seedance
3. **Seedance 单次最长 15s** — 长视频必须分段
4. **Replicate 需要 URL 输入** — 本地图片需先上传到可访问 URL（可用 Replicate file upload 或 S3）
5. **生成耗时约 2-4 分钟/段** — 3 段 ≈ 10 分钟，需异步编排
6. **角色一致性 = 最大挑战** — 每次 prompt 都要详细重复角色物理描述
7. **必须包含 "Do not reinterpret / skip / reorder / merge / invent"** — 否则模型偏离分镜
8. **分镜 prompt ≈ 视频 prompt** — 设计时考虑复用，避免写两套描述

### 6.4 Prompt 生成的自动化策略

基于社区实践，prompt 可以半自动化组装：

```python
def build_seedance_prompt(
    intent: str,
    reference_desc: str,
    rules: list[str],
    shots: list[dict],  # [{time, shot_type, camera, action, physics}]
    style: str,
    camera_notes: list[str],
    sound_design: str,
    negative: list[str],
    end_state: str,
    continuity_note: str = None,
    total_duration: int = 15,
    aspect_ratio: str = "16:9",
) -> str:
    parts = []

    # 总领
    parts.append(intent)
    parts.append("")
    parts.append(reference_desc)
    parts.append("")

    # Rules
    parts.append("RULES:")
    for r in rules:
        parts.append(f"• {r}")
    parts.append("")

    # Continuity
    if continuity_note:
        parts.append("VERY IMPORTANT CONTINUITY NOTE:")
        parts.append(continuity_note)
        parts.append("")

    # Style
    parts.append(f"STYLE:\n{style}")
    parts.append("")

    # Timing
    parts.append(f"TIMING:\n{total_duration} seconds total. {len(shots)} shots.")
    parts.append("")

    # Shots
    parts.append("SHOT SEQUENCE:")
    for i, shot in enumerate(shots, 1):
        line = f"Shot {i} ({shot['time']}) {shot.get('shot_type', '')} • {shot.get('camera', '')}"
        if shot.get('title'):
            line += f" — {shot['title']}"
        parts.append(line)
        parts.append(shot['action'])
        if shot.get('physics'):
            parts.append(shot['physics'])
        parts.append("")

    # Camera
    parts.append("CAMERA DIRECTION:")
    for c in camera_notes:
        parts.append(f"• {c}")
    parts.append("")

    # Sound
    parts.append(f"SOUND DESIGN:\n{sound_design}")
    parts.append("")

    # Negative
    parts.append("NEGATIVE INSTRUCTIONS:")
    for n in negative:
        parts.append(f"Do not {n}.")
    parts.append("")

    # End state
    parts.append(f"END STATE:\n{end_state}")
    parts.append("")

    # Footer
    parts.append(f"Total: {total_duration}s / {len(shots)} shots / {aspect_ratio}")

    return "\n".join(parts)
```

---

## 7. 三大核心难题：角色统一、剧情完整、无缝衔接

> AI 长视频的本质挑战是"跨片段一致性"——Seedance 每次只能生成 15 秒，
> 信息在片段边界丢失。以下是经过社区验证的系统性解法。

### 7.1 角色统一：三层防线

**核心矛盾**：Seedance 的 `reference_images` 最多 9 张，且与 `image`（首帧）互斥。每次生成都是独立调用，模型没有"记忆"。

#### 第 1 层：角色参考表（视觉锚定）

每个角色生成一张多角度参考表，每次视频生成都作为 `reference_images` 传入。

- 用 GPT Image 2 的 `images.edit()` + `input_fidelity="high"` 生成
- 参考表内容：正面/侧面/背面全身 + 表情特写 + 关键道具
- **始终放在 reference_images[0]**（第一张获得最高保真度）

#### 第 2 层：Prompt 中重复详细物理描述（文本锚定）

来自 capy-video-gen-skill 的 300 次实验结论——每段 prompt 都要完整重复角色描述：

```
Keep the same young male chef throughout: expressive face, dark brown wavy
hair, white chef jacket with black buttons, dark apron.
```

**不要**用 "same character as before"——模型看不到"before"。用精确色彩词：`charcoal grey wool` 而非 `dark coat`。

#### 第 3 层：Seed 固定（风格锚定）

```python
"seed": 42  # 同一项目所有片段用相同 seed
```

固定 seed 不保证角色完全一致，但能保证渲染风格、光照倾向、色调一致，减少视觉跳跃感。

#### 角色统一的常见陷阱

| 问题 | 原因 | 解法 |
|------|------|------|
| 身高/比例漂移 | 没有全身参考 | 参考表必须包含全身图并标注身高比例 |
| 服装颜色偏移 | prompt 描述不够具体 | 用精确色彩词 `"charcoal grey wool"` 而非 `"dark coat"` |
| 多角色混淆 | reference_images 中多人混在一起 | 每角色独立参考表，prompt 中用 `[Image1]` `[Image2]` 明确指代 |
| 面部变形 | 参考图不够清晰 | 角色表中面部特写至少占一个区域，正面光照 |

#### 退化方案（当 reference_images 效果不够）

如果 `reference_images` 模式的角色一致性不够（当前社区反馈约 70-80% 成功率），退化方案：

1. 用 GPT Image 2 将角色合成到场景中生成首帧图
2. 将该图作为 `image`（首帧锚定模式）传入 Seedance
3. 牺牲构图自由度，换取角色精确一致

```python
# 退化方案代码
first_frame = client.images.edit(
    model="gpt-image-1",
    image=[character_ref, scene_background],
    prompt="Place character from image 1 into scene from image 2, exact appearance...",
    input_fidelity="high",
    size="1536x1024"
)
# 保存 first_frame 后作为 Seedance 的 image 参数
```

---

### 7.2 剧情完整：结构化编剧

**核心矛盾**：15 秒内塞不下复杂叙事，多段拼接时叙事节奏容易断裂或重复。

**关键原则**：剧情完整性不靠视频生成解决，靠前置的剧本结构解决。

#### 步骤 1：LLM 生成结构化剧本

不要用自由文本，输出结构化 JSON：

```json
{
  "title": "沙漠追逐",
  "total_duration": 90,
  "characters": [
    {"id": "A", "name": "探险者", "description": "...详细物理描述..."}
  ],
  "acts": [
    {
      "act": 1, "name": "建置", "duration_target": 30,
      "emotional_arc": "平静 → 紧张",
      "shots": [
        {"id": 1, "time": "0-5s", "type": "EWS", "action": "沙漠全景，远处一个人影奔跑", "emotion": "紧张"},
        {"id": 2, "time": "5-10s", "type": "MS", "action": "主角回头看追兵", "emotion": "恐惧"}
      ]
    },
    {
      "act": 2, "name": "对抗", "duration_target": 45,
      "emotional_arc": "恐惧 → 决心",
      "shots": []
    },
    {
      "act": 3, "name": "解决", "duration_target": 15,
      "emotional_arc": "决心 → 释然",
      "shots": []
    }
  ]
}
```

#### 步骤 2：按 15 秒切割但不按 15 秒思考

```
剧本以"幕"为单位设计（30-60s），保证有起承转合
然后才机械地按 15s 切片分配给 Seedance
切片边界尽量落在情绪转换点（自然的"切"感）
```

#### 步骤 3：每段 prompt 包含上下文声明

```
This is segment 3 of 6.
The story so far: [主角已逃出基地，正在沙漠中被追击].
This segment covers: [追兵逼近，主角发现绿洲].
Next segment will cover: [主角在绿洲设下陷阱].
```

Seedance 不真的"理解"上下文，但这段文字帮助它在动作选择上更合理——不会在"追击段"生成悠闲步行。

#### 剧情断裂的常见原因和修复

| 症状 | 原因 | 修复 |
|------|------|------|
| 重复镜头 | 分镜板中 panel 重复 | 生成后检查 + GPT Image 2 修正指定 panel |
| 节奏断裂 | 段间情绪跳跃 | 每段 END STATE 必须是下段开头的自然前提 |
| 逻辑不连贯 | 直接从描述生成，没有剧本结构 | 必须有 Act 结构，不能跳过编剧步骤 |
| 信息丢失 | 某段的关键道具/角色在后续消失 | 每段 prompt 重复所有在场元素 |
| 时间感错乱 | 快慢节奏随机 | 在 JSON 中预分配每段 shot 密度 |

---

### 7.3 分镜无缝衔接：四种手段组合

**核心矛盾**：两个独立生成的 15 秒视频，最后一帧和第一帧之间必然存在跳变。

#### 手段 1：首帧/末帧锚定（最可靠）

```python
# 提取 clip_1 最后一帧
last_frame = extract_last_frame("clip_1.mp4")
upload_url = upload_to_replicate(last_frame)

# 生成 clip_2 时用作首帧
output = replicate.run("bytedance/seedance-2.0", input={
    "image": upload_url,                    # 锁定首帧
    "last_frame_image": next_panel_url,     # 可选：锁定末帧走向
    "prompt": "...",
    "duration": 15
})
```

**限制**：使用 `image` 后不能同时用 `reference_images`。补偿方法——在 prompt 中用超详细文字描述补偿角色参考的缺失。

#### 手段 2：CONTINUITY NOTE（语义连续）

```
VERY IMPORTANT CONTINUITY NOTE:
This clip must feel like a direct continuation of the previous clip.
Start with [精确描述上一段最后的画面状态].
Maintain the same character, same environment, same lighting,
same camera distance, and same emotional tone.
The two clips must join seamlessly when edited together.
```

#### 手段 3：镜头遮挡转场（物理遮挡掩盖跳变）

当两段之间实在难以精确衔接时，用物理遮挡创造自然切换点：

```
上一段末尾 prompt:
...the character walks directly toward the camera, body gradually
filling the entire frame until complete darkness.

下一段开头 prompt:
Starting from complete darkness/obstruction, slowly pulling back
to reveal [新场景描述]...
```

可用的遮挡手法：
- 角色走到镜头正前方 → 黑屏 → 新场景
- 沙尘/烟雾/火焰覆盖镜头
- 物体飞向镜头（沙子/水花/布料）
- 快速甩镜（whip pan）造成运动模糊
- 强光过曝 → 新场景淡入

#### 手段 4：FFmpeg 后期补救

```bash
# 0.3-0.5秒的交叉淡入淡出，掩盖轻微不连续
ffmpeg -i clip1.mp4 -i clip2.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.3:offset=14.7[v]" \
  -map "[v]" -c:v libx264 output.mp4
```

可用转场效果：`fade`, `dissolve`, `wipeleft`, `circleopen`, `fadeblack`, `fadewhite`

#### 衔接策略选择矩阵

| 场景类型 | 推荐手段 | 原因 |
|----------|---------|------|
| 同一连续动作（追逐/打斗） | 手段1（首帧锚定） | 必须帧级精确 |
| 场景切换（室内→室外） | 手段3（遮挡转场） | 不需要连续，反而需要明确的"切" |
| 同场景不同动作 | 手段2 + 手段4 | 语义连续即可 |
| 蒙太奇/快节奏剪辑 | 手段4（硬切/whip） | 快节奏允许跳变 |
| 教程/步骤类 | 手段2（CONTINUITY NOTE） | 环境一致比帧精确更重要 |

---

### 7.4 综合方案总结

```
角色统一 = 参考表(视觉) + 每段重复描述(文本) + 固定seed(风格)
剧情完整 = LLM结构化编剧 + Act结构 + 上下文声明 + END STATE
无缝衔接 = 首帧锚定 + CONTINUITY NOTE + 遮挡转场 + 后期淡入淡出
```

#### 产品中的自动化决策逻辑

```python
def choose_transition_strategy(prev_shot: dict, next_shot: dict) -> str:
    """根据前后镜头关系自动选择衔接策略"""

    if prev_shot["scene"] == next_shot["scene"] and prev_shot["action_continuous"]:
        # 同场景连续动作 → 首帧锚定
        return "first_frame_anchor"

    elif prev_shot["scene"] != next_shot["scene"]:
        # 场景切换 → 遮挡转场
        return "occlusion_transition"

    elif prev_shot["pace"] == "fast" and next_shot["pace"] == "fast":
        # 快节奏蒙太奇 → 硬切
        return "hard_cut"

    else:
        # 默认 → CONTINUITY NOTE + 淡入淡出
        return "continuity_note_with_crossfade"
```

---

## 附录：快速上手命令

```bash
# 安装依赖
pip install openai replicate pillow opencv-python

# 确保有 ffmpeg
brew install ffmpeg  # macOS

# 设置 API keys
export OPENAI_API_KEY="sk-..."
export REPLICATE_API_TOKEN="r8_..."
```
