import type { SceneSpec, VideoStyle } from "../types.js";

const STYLE_KEYWORDS: Record<VideoStyle, string> = {
  cinematic:
    "Photorealistic cinematic rendering. 35mm film quality, natural lighting, realistic materials and textures. Subtle film grain, soft highlight rolloff.",
  anime:
    "Full-color 2D anime style, cel shading, clean line art, vibrant but harmonious color palette. No characters present.",
  "3d-pixar":
    "Pixar 3D animation style. Bright saturated colors, smooth subsurface scattering, render-quality lighting. No characters present.",
};

export function buildSceneRefPrompt(
  scene: SceneSpec,
  style: VideoStyle,
): string {
  const styleBlock = STYLE_KEYWORDS[style] ?? STYLE_KEYWORDS["cinematic"];

  return `Empty environment reference image.

${scene.detail}

REQUIREMENTS:
- No people, no characters, no figures of any kind.
- Show the environment as an establishing shot — wide angle, full spatial context visible.
- Consistent with the following visual style: ${styleBlock}
- Aspect ratio: 16:9

Do not add text overlays, watermarks, or labels.`;
}
