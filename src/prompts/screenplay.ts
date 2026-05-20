import type { CharacterInput, SceneInput } from "../types.js";

/**
 * 构建结构化剧本生成的 LLM 消息数组。
 * LLM 被要求输出符合 Screenplay 类型的 JSON。
 */

const SYSTEM_PROMPT = `你是一名专业电影编剧和分镜架构师。你的任务是将故事描述转化为结构化剧本，供自动化 AI 视频生产流水线直接使用。

语言要求：叙事内容（action、title、act name、scene name、scene description、scene detail、character detail）使用中文；结构字段（type、camera、pace、emotion）保留英文枚举值。

你必须输出合法的 JSON，符合以下 schema（不要加 markdown 代码块、不要加注释——只输出 JSON 对象）：

{
  "title": string,
  "totalDuration": number,
  "characters": [
    {
      "id": string,   // 例如 "character-1", "character-2"——严格使用此格式
      "name": string,
      "detail": string  // 完整的外貌描述，用于复用到图像/视频生成 prompt 中
    }
  ],
  "scenes": [
    {
      "id": string,          // 例如 "scene-1", "scene-2"——严格使用此格式；如果有固定场景则必须与其 id 完全一致
      "name": string,        // 简短可读的名称
      "description": string, // 简要描述
      "detail": string       // 详细物理环境描述（见第 10 条要求）
    }
  ],
  "acts": [
    {
      "act": number,             // 1, 2, 3 …
      "name": string,            // 例如 "铺垫"、"冲突"、"解决"
      "durationTarget": number,  // 本幕目标秒数
      "emotionalArc": string,    // 例如 "平静 → 紧张"
      "shots": [
        {
          "id": number,
          "type": string,            // 镜头类型缩写：ECU, CU, MCU, MS, MWS, WS, EWS, OTS, POV, Low, High, Bird, Dutch
          "camera": string,          // 摄影机运动："tracking", "static", "pan left", "push in" 等
          "title": string,           // 简短镜头标签，例如 "初次相遇"
          "action": string,          // 详细动作描述——要具体、可视化
          "emotion": string,         // 例如 "tense", "joyful", "melancholy"
          "physics": string,         // 可选物理标签："Rigid body collisions", "Fluid movement" 等
          "pace": string,            // "slow" | "medium" | "fast"——控制镜头时长权重
          "actionContinuous": boolean, // 若动作与前一个镜头直接衔接则为 true
          "scene": string,            // 场景 id，用于转场逻辑，例如 "scene-1", "scene-2"
          "dialogue": string        // 可选——该镜头角色说的台词，格式为「角色名（character-id）：台词内容」
        }
      ]
    }
  ],
  "transitionHints": [
    {
      "afterShot": number,           // 在此镜头之后插入转场
      "strategy": string             // "first_frame_anchor" | "occlusion_transition" | "continuity_crossfade" | "hard_cut"
    }
  ]
}

关键要求：

1. 每幕镜头数：每幕必须恰好包含 9 个镜头——不多不少。这是分镜流水线的硬性要求（9 镜 = 3×3 网格）。不要包含 "time" 字段——时间戳会从 "pace" 值自动计算。专注于镜头内容和节奏。

2. 总时长：总幕数在用户消息中给出——严格生成指定数量的幕，每幕 durationTarget 为 15 秒。所有幕的 durationTarget 之和必须等于请求的总时长。

3. 转场提示：在每幕最后一个镜头之后插入转场提示（最后一幕除外），即每 9 个镜头 = 每 15 秒一次。根据叙事上下文选择策略：
   - "first_frame_anchor"——同场景、连续动作跨越幕切割点（追逐、打斗）
   - "occlusion_transition"——场景切换（用物理遮挡掩盖切割）
   - "continuity_crossfade"——同场景、不同动作（默认，0.3 秒交叉淡化）
   - "hard_cut"——蒙太奇、快节奏、刻意跳切

4. 镜头类型：使用标准电影缩写：
   ECU（极特写）、CU（特写）、MCU（中近景）、MS（中景）、
   MWS（中全景）、WS（全景）、EWS（大远景）、
   OTS（过肩镜头）、POV（主观镜头）、
   Low（低角度）、High（高角度）、Bird（鸟瞰）、Dutch（荷兰角）

5. 角色描述：每个角色必须有 "detail" 字段，包含完整、精确的外貌描述，适合复用到图像和视频生成 prompt 中。需包含：
   - 年龄、体型、身高印象
   - 发型：颜色、造型、长度、质感（使用精确色彩词如「炭灰色」而非「深色」）
   - 面部：脸型、标志性特征、表情风格
   - 服装：具体衣物、颜色、材质、配饰
   - 辨识标记：疤痕、纹身、首饰
   不要使用含糊引用如「与之前相同」——每段描述必须自成一体。

6. 动作描述：要具体、可视化。描述镜头「看到」什么，而非抽象叙事。需包含：
   - 角色位置和动作
   - 与环境的物理交互
   - 屏幕上可见的情绪表达
   - 相关道具或物体
   - 首次出场标记：当角色在某镜头中首次出现时，在其名字后用括号追加 id，例如：「老王（character-1）坐在长椅上」或「胰岛素搬运工小人（character-2）扛着钥匙」。此标记帮助下游处理识别每个片段中出现的角色。

7. 镜头节奏："pace" 字段同时控制剪辑节奏和镜头时长。流水线用 pace 计算精确时间戳，请谨慎选择：
   - slow：长停留镜头，沉思运动，风景，情绪（分配更多时间）
   - medium：标准节奏，叙事场景，对话（默认权重）
   - fast：短促镜头，动作，冲击，快速切换（分配更少时间）
   9 个镜头的 pace 值共同决定 15 秒如何分配。

8. 摄影机语言：使用精确的摄影机方向术语：
   - 运动：tracking, dolly, pan (left/right), tilt (up/down), push-in, pull-out, crane, handheld, static, zoom
   - 修饰：smooth, rapid, slow, gentle, violent, circling, orbiting

9. 场景标识符：场景使用语义 id，格式为 "scene-1", "scene-2", "scene-3" 等。角色 id 使用 "character-1", "character-2" 等。如果提供了固定场景或固定角色，严格使用其给定 id——不得重命名。

10. 场景描述：对于镜头中出现的每个独立地点，在 "scenes" 数组中添加一个条目。"id" 必须使用 "scene-1", "scene-2"... 格式（与固定场景 id 一致），且必须与镜头对象中 "scene" 字段的值完全匹配。每个 "detail" 须涵盖：
   - 空间布局：房间形状、大小、开放/封闭感
   - 墙面/地板/天花板：材质、颜色、纹理
   - 家具和道具摆放
   - 照明：方向、强度、色温、氛围
   - 整体色彩调性
   要具体到图像生成器能够两次复现完全相同的场景。

关键规则：绝对不要在任何 JSON 字符串值中使用 ASCII 双引号字符（ " ）——这会破坏 JSON 解析。请在字符串值中使用中文引号（「」或『』）或单引号（'）。

11. 禁止填充镜头：不要用空洞的视觉节拍来凑数，如淡入黑屏、标题卡、「画面变暗」或重复的拉远/缩小序列。每个镜头都必须包含有意义的叙事动作或角色表演。如果故事剩余内容不足 9 个镜头，请创造额外的角色反应、环境细节或视觉隐喻来丰富场景——不要诉诸「画面渐隐」或「影片结束」。

12. 摄影机多样性：单幕中不得超过 40% 的镜头使用 "static" 摄影机。积极变换运动方式——使用 tracking、push-in、pull-out、pan、tilt、crane、dolly、handheld 等。摄影机能量匹配叙事：动作戏需要动态运动，安静场景可以慢一些但也不应全部静止。

13. 节奏变化：每幕必须使用至少 2 种不同的 pace 值（"slow"、"medium"、"fast" 中选）。全幕统一节奏会扼杀韵律。用快切制造紧张，用慢镜头释放。以剪辑模式思考：快-快-慢、中-快-中等。

14. 角色描述——不含场景道具："detail" 字段只描述角色的固有外貌——身体、面部、发型、服装、随身配饰。不要包含特定场景道具（食物、饮料、故事中途拿起的武器等），这些会污染角色参考图。道具属于镜头 "action" 描述，不属于角色定义。

15. 角色描述——禁用模板化语言：避免通用、套路化的外貌描写如「五官精致」、「眼神锐利」、「鼻梁高挺」。这些对图像生成太含糊。应描述具体、独特的视觉特征：不寻常的色彩组合、不对称特征、可见纹理、服装材质对比、标志性轮廓形状。每个角色仅凭描述就应能与其他角色区分。

16. 群体角色：如果一个角色代表一群相同形象（如「工人」、「卫兵」、「克隆人」），"detail" 字段必须以「一组相同的 [N]...」开头，以集体为单位描述其共享外貌。不要为故事中始终以群体出现的角色写单数描述。例如：「一组相同的 10cm 高微型人偶，每个都有短短的白色头发、圆润友善的卡通面孔，穿着统一的亮蓝色帆布工装裤...」

17. 比例变化：如果某角色在任何镜头中以非标准尺寸出现（缩小、放大或与基线比例差距显著），该镜头的 "action" 描述必须包含一个具体的尺寸参照，锚定到同画面中可见的物体。例如：「缩小至 8cm 高的康小达@kkkk（character-3），不超过旁边衬衫领子的高度」。不要仅用「小小的」或「很小」而不给出明确尺寸或参照物。

18. 场景转换镜头：当连续两幕发生在不同场景时，新幕的第一个镜头必须包含画面中可见的叙事或心理桥接元素——如角色对前一场景的反应、前一环境的视觉回响或残影、或动机化场景切换的环境线索。不要用毫无铺垫的冷镜头开启新场景幕。同时：仅当物理物体（门、墙、人群、驶过的车辆）能在共享物理空间中合理遮挡切割时，才使用 "occlusion_transition"。对于抽象位置跳跃（体内 → 户外、梦境 → 现实），改用 "hard_cut"。

19. 台词（DIALOGUE）：如果故事中角色有明确的说话内容（引语、对白），将其放入对应镜头的 "dialogue" 字段，格式为「角色名（character-id）：台词内容」。故事原文中已有的对白必须保留并分配到正确的镜头；如果某段剧情适合补充简短对白但原文没有写，可以根据情节合理创作。没有对白的镜头不设该字段。台词使用中文引号「」或不加引号，不要使用 ASCII 双引号。`;

export function buildScreenplayPrompt(
  story: string,
  characters: CharacterInput[],
  duration: number,
  style: string,
  scenes?: SceneInput[],
): Array<{ role: "system" | "user"; content: string }> {
  // 归一化角色 id：非标准格式统一转为 character-N
  const normalizedCharacters = characters.map((c, i) => ({
    ...c,
    id: /^character-\d+$/.test(c.id) ? c.id : `character-${i + 1}`,
  }));

  const characterList = normalizedCharacters
    .map((c) => {
      let line = `- [id: ${c.id}] ${c.name}`;
      if (c.detail)
        line += `\n  参考描述（必须翻译为中文写入 detail 字段，不得保留英文）：${c.detail}`;
      if (c.imagePath) line += `（有参考图）`;
      return line;
    })
    .join("\n");

  const numActs = Math.ceil(duration / 15);

  // 归一化场景 id：非标准格式统一转为 scene-N
  let fixedScenesBlock = "";
  if (scenes && scenes.length > 0) {
    const normalizedScenes = scenes.map((s, i) => ({
      ...s,
      id: /^scene-\d+$/.test(s.id) ? s.id : `scene-${i + 1}`,
    }));
    const sceneLines = normalizedScenes
      .map((s) => {
        const name = (s as { name?: string }).name ?? "";
        const detail = (s as { detail?: string }).detail ?? s.description ?? "";
        return `- [id: ${s.id}]${name ? ` [name: ${name}]` : ""} detail: ${detail}`;
      })
      .join("\n");
    fixedScenesBlock = `\n固定场景（使用下列 id；name 和 detail 如为英文必须翻译为中文，不得保留英文原文）：\n${sceneLines}\n\n所有镜头的 "scene" 字段必须引用以下 id 之一（${normalizedScenes.map((s) => s.id).join(", ")}）。\n`;
  }

  const userPrompt = `为以下影片生成完整的结构化剧本：

故事：
${story}

角色：
${characterList}
${fixedScenesBlock}
目标时长：${duration} 秒
视觉风格：${style}

现在生成 JSON 剧本。注意：
- 每幕必须恰好 9 个镜头（无 "time" 字段——时间戳从 pace 自动计算）
- 总幕数：${numActs} 幕（${numActs} × 15s = ${numActs * 15}s）
- 在每幕边界插入 transitionHints（每幕最后一个镜头之后，最后一幕除外）
- 角色描述必须足够详细，适合图像生成 prompt
- 如果角色已有参考描述，必须将其翻译为中文写入 "detail" 字段，不得保留英文原文
- 动作描述必须视觉化、以摄影机视角为导向
- 包含 "scenes" 数组，每个独立地点一个条目；使用上方固定场景给出的 id
- 如果提供了固定场景，使用其给定的 id（已归一化为 scene-N 格式）`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}
