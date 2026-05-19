import type { CharacterSpec, VideoStyle } from "../types.js";

/** 风格关键词映射 */
const STYLE_KEYWORDS: Record<VideoStyle, string> = {
  cinematic:
    "照片级真实电影渲染。35mm胶片质感，自然皮肤纹理，真实布料与材质表现。细腻胶片颗粒感，柔和高光过渡。",
  anime:
    "全彩2D动画风格，赛璐璐着色，干净线稿，鲜明而和谐的配色。动画比例的富有表现力的五官特征。",
  "3d-pixar":
    "皮克斯3D鲜明动画风格。高饱和度明亮色彩。皮肤细腻的次表面散射。表情夸张度拉满至皮克斯级别。渲染级光照。",
};

/** 视角描述映射 */
const VIEW_DESC: Record<"front" | "three-quarter", string> = {
  front: "正面全身，自然站立姿势，面朝镜头",
  "three-quarter": "3/4右侧全身，身体微微右转，展示立体轮廓",
};

/**
 * 生成单视角角色参考图的提示词。
 * 用于 GPT Image 2 生成干净的单张角色图，作为 Seedance 视频生成的参考素材。
 */
export function buildCharacterRefPrompt(
  character: CharacterSpec,
  style: string,
  view: "front" | "three-quarter",
): string {
  const styleKey = style as VideoStyle;
  const styleBlock = STYLE_KEYWORDS[styleKey] ?? STYLE_KEYWORDS["cinematic"];
  const viewDesc = VIEW_DESC[view];

  return `生成一张干净的角色参考图，用于视频制作中的角色一致性参考。

角色：${character.name}
${character.detail}

视角：${viewDesc}

风格：
${styleBlock}

要求：
- 干净的白色或纯色中性背景
- 仅包含该角色一人，画面中无其他人物
- 全身可见，从头顶到脚底完整呈现
- 光照均匀明亮，清晰展现五官、服装与材质细节
- 不加任何文字标注、身高刻度条、网格线
- 不使用模型表/设定图的多视角排列布局

负面提示：不要多个角色、不要复杂背景、不要文字、不要水印、不要其他人物、不要模型表布局、不要多视角拼图。`;
}
