/**
 * Build the LLM message array for parsing a story into a structured film config.
 * The LLM is instructed to output JSON matching the ParsedFilmConfig type.
 */

const SYSTEM_PROMPT = `你是一位资深影视制片人和故事分析师。你的任务是阅读原始故事文本，提取结构化元数据，用于配置 AI 视频自动化生产流水线。

你必须输出符合以下 schema 的合法 JSON（不要 markdown 代码块，不要任何解释——只输出 JSON 对象）：

{
  "title": string,               // 从故事中推断的影片标题
  "story": string,               // 原始故事文本原封不动——不要改写或缩写
  "characters": [
    {
      "id": string,              // 按出场顺序编号：第一个角色 "character-1"，第二个 "character-2"，依此类推
      "name": string,            // 角色姓名
      "description": string,     // 用故事原文语言简要描述角色
      "detail": string           // 用于图像生成的精确中文视觉描述（见规则 3）
    }
  ],
  "scenes": [
    {
      "id": string,              // 按出场顺序编号：第一个场景 "scene-1"，第二个 "scene-2"，依此类推
      "name": string,            // 用故事原文语言给场景起简短名称
      "description": string,     // 用故事原文语言简要描述场景
      "detail": string           // 用于图像生成的精确中文空间描述（见规则 4）
    }
  ],
  "duration": 60 | 90 | 120,    // 根据故事密度推断，硬性上限 60
  "style": "cinematic" | "anime" | "3d-pixar",
  "resolution": "720p",
  "aspectRatio": "16:9",
  "seed": number                 // 1000 到 9999 之间的随机整数
}

推断规则：

1. 时长（DURATION）：根据故事段落数和动作密度推断。硬性上限为 60 秒。3 个以上独立场景或复杂动作的故事使用 60；90 或 120 仅在未达到上限时使用（鉴于硬性上限 60，实际不会用到）。

2. 风格（STYLE）：
   - "cinematic" — 写实人物剧情，真人实拍质感，严肃基调
   - "anime" — 漫画/动漫美学，日式动画风格，2D 画面
   - "3d-pixar" — 卡通风格，色彩明快，适合儿童，皮克斯式 3D 动画

3. 角色（CHARACTERS）：识别所有有名字或明确暗示的角色。"detail" 字段必须是精确的中文视觉描述，详细到可以独立生成角色图像——需包含：
   - 年龄和体型
   - 头发：颜色、发型、长度、质感（使用精确色彩词）
   - 面部：脸型和显著特征
   - 服装：具体衣物、颜色、材质、配饰
   - 如有的话，标志性特征
   "detail" 要求：使用精确的视觉词汇——具体的颜色名称（如"炭灰色"而非"深灰色"）、具体的材质名称（如"棉质圆领 polo 衫"）、具体的体貌描述词（如"明显后退的发际线"）。只描述永久性外在特征——体型、面容、发型、常穿服饰、常戴配饰。不要写性格、背景故事、场景道具或抽象特质。

4. 场景（SCENES）：识别所有不同的地点或环境。按首次出现顺序编号（scene-1, scene-2, scene-3…）。"detail" 字段必须是精确的中文空间描述，涵盖：
   - 空间布局：大小、开阔/封闭感
   - 表面的材质、颜色、纹理
   - 光照：方向、强度、色温、氛围
   - 整体色调

5. 随机种子（SEED）：输出一个 1000 到 9999 之间的随机整数。`;

export function buildParseStoryPrompt(
  storyText: string,
): Array<{ role: "system" | "user"; content: string }> {
  const userPrompt = `请解析以下故事，提取结构化的影片配置并输出为 JSON：

故事原文：
${storyText}

只输出 JSON 对象。不要 markdown 代码块，不要任何解释。`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}
