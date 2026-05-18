import type { CharacterSpec, VideoStyle } from "../types.js";

/**
 * Build an image generation prompt for a character reference / turnaround sheet.
 * The output prompt is intended for GPT Image 2 (images.generate or images.edit).
 */

const STYLE_KEYWORDS: Record<VideoStyle, string> = {
  cinematic:
    "Photorealistic cinematic rendering. 35mm film quality, natural skin textures, realistic fabric and material rendering. Subtle film grain, soft highlight rolloff.",
  anime:
    "Full-color 2D anime style, cel shading, clean line art, vibrant but harmonious color palette. Expressive features with anime proportions.",
  "3d-pixar":
    "Pixar 3D vivid animation style. Bright saturated colors throughout. Smooth subsurface scattering on skin. Expressions pushed to maximum Pixar exaggeration. Render-quality lighting.",
};

export function buildCharacterSheetPrompt(
  character: CharacterSpec,
  style: string,
): string {
  const styleKey = style as VideoStyle;
  const styleBlock = STYLE_KEYWORDS[styleKey] ?? STYLE_KEYWORDS["cinematic"];

  const desc = character.detail;

  return `Generate a professional character reference sheet / model sheet for animation and video production.

CHARACTER: ${character.name}
${desc}

LAYOUT — arrange the following views on a single image with a clean white background:
- Front view: full body, neutral standing pose, arms slightly away from sides
- 3/4 view: full body, slight right turn
- Side view / profile: full body, facing right
- Back view: full body
- Head close-ups row: front, 3/4, and profile
- Key expressions: neutral, intense/angry, surprised/shocked

LABEL each view clearly with small text below.

INCLUDE a height reference bar on the left side.

STYLE:
${styleBlock}

REQUIREMENTS:
- Single character only — no other figures or people
- White or neutral solid background — no complex environments or scenery
- Consistent appearance across ALL views (same clothing, hair, features)
- No text overlays, watermarks, or decorative borders beyond the view labels
- No props or weapons unless they are part of the character's standard appearance
- Clean, well-lit rendering showing all surface details clearly

NEGATIVE: no multiple characters, no complex backgrounds, no text overlays, no watermarks, no logos, no scene context, no other people.`;
}
