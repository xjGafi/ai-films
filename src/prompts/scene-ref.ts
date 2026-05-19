import type { SceneSpec, VideoStyle } from "../types.js";

const STYLE_KEYWORDS: Record<VideoStyle, string> = {
  cinematic:
    "照片级真实电影渲染。35mm胶片质感，自然光照，真实材质与纹理。细腻胶片颗粒，柔和高光过渡。",
  anime:
    "全彩2D动画风格，赛璐璐着色，干净线稿，鲜艳和谐的色彩搭配。画面中无人物。",
  "3d-pixar":
    "皮克斯3D动画风格。明亮饱和色彩，柔滑次表面散射，渲染级光照。画面中无人物。",
};

export function buildSceneRefPrompt(
  scene: SceneSpec,
  style: VideoStyle,
): string {
  const styleBlock = STYLE_KEYWORDS[style] ?? STYLE_KEYWORDS["cinematic"];

  return `空场景环境参考图。

${scene.detail}

要求：
- 画面中不出现任何人物、角色或人形。
- 以建立镜头呈现环境——广角，完整空间全貌可见。
- 符合以下视觉风格：${styleBlock}
- 画面比例：16:9

不要添加文字水印或标签。`;
}
