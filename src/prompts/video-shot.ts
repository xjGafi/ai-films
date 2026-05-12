import type { VideoPromptConfig, VideoStyle } from "../types.js";

const SHOTS_PER_ROW = 3;

/**
 * Build a Seedance 2.0 video generation prompt following the structured format
 * from the tech guide §3.2.
 *
 * Structure:
 *   1. INTENT
 *   2. REFERENCE DESCRIPTION
 *   3. RULES
 *   4. CONTINUITY NOTE (conditional)
 *   5. STYLE
 *   6. SHOTS
 *   7. CAMERA NOTES
 *   8. SOUND DESIGN
 *   9. NEGATIVE INSTRUCTIONS
 *  10. END STATE
 *  11. Footer (total duration / shot count / aspect ratio)
 */

const STYLE_TEMPLATES: Record<VideoStyle, string> = {
  cinematic: `cinematic lighting, photorealistic, 35mm film quality, ARRI ALEXA aesthetic,
heavy film grain, noticeable focus breathing, motion blur on fast actions,
halation on highlights, soft highlight rolloff, slightly desaturated tones`,
  anime: `full-color 2D anime, cel shading, rough impact lines, colored debris and dust,
expressive animation, dynamic pose exaggeration`,
  "3d-pixar": `Pixar 3D vivid animation. Bright saturated colors throughout.
Expressions pushed to maximum Pixar exaggeration. Smooth subsurface scattering.
Render-quality volumetric lighting.`,
};

export function buildSeedancePrompt(config: VideoPromptConfig): string {
  const parts: string[] = [];

  // 1. INTENT
  parts.push(config.intent);
  parts.push("");

  // 2. REFERENCE DESCRIPTION
  parts.push(config.referenceDesc);
  parts.push("");

  // 3. RULES
  parts.push("RULES:");
  for (const rule of config.rules) {
    parts.push(`• ${rule}`);
  }
  // Always include the anti-interpretation rule (critical per tech guide §6.3)
  parts.push(
    `• Follow the sequence exactly. Do not skip, reorder, merge, or invent steps.`,
  );
  parts.push("");

  // 4. CONTINUITY NOTE (conditional)
  if (config.continuityNote) {
    parts.push("VERY IMPORTANT CONTINUITY NOTE:");
    parts.push(config.continuityNote);
    parts.push("The two clips must join seamlessly when edited together.");
    parts.push("");
  }

  // 5. STYLE
  const styleKey = config.style as VideoStyle;
  const styleBlock = STYLE_TEMPLATES[styleKey] ?? STYLE_TEMPLATES["cinematic"];
  parts.push("STYLE:");
  parts.push(styleBlock);
  parts.push("");

  // 6. SHOTS
  parts.push("SHOT SEQUENCE:");
  const numRows = Math.ceil(config.shots.length / SHOTS_PER_ROW);
  const rowDuration = config.totalDuration / numRows;
  for (let i = 0; i < config.shots.length; i++) {
    if (i % SHOTS_PER_ROW === 0) {
      const rowNum = Math.floor(i / SHOTS_PER_ROW) + 1;
      const rowStart = Math.round((rowNum - 1) * rowDuration);
      const rowEnd = Math.round(rowNum * rowDuration);
      parts.push(`[Row ${rowNum} — ${rowStart}–${rowEnd}s]`);
    }

    const shot = config.shots[i];
    const shotNum = i + 1;
    const time = shot.time;
    const shotType = shot.type ?? "";
    const camera = shot.camera ?? "";
    const title = shot.title ?? "";

    let header = `Shot ${shotNum} (${time})`;
    if (shotType) header += ` [${shotType}]`;
    if (camera) header += ` • ${camera}`;
    if (title) header += ` — ${title}`;
    parts.push(header);

    parts.push(shot.action);

    if (shot.physics) {
      parts.push(shot.physics);
    }

    parts.push("");
  }

  // 7. CAMERA NOTES
  if (config.cameraNotes.length > 0) {
    parts.push("CAMERA DIRECTION:");
    for (const note of config.cameraNotes) {
      parts.push(`• ${note}`);
    }
    parts.push("");
  }

  // 8. SOUND DESIGN
  parts.push("SOUND DESIGN:");
  parts.push(config.soundDesign);
  parts.push("");

  // 9. NEGATIVE INSTRUCTIONS
  parts.push("NEGATIVE INSTRUCTIONS:");
  for (const neg of config.negatives) {
    parts.push(`Do not ${neg}.`);
  }
  parts.push(
    "Do not add text overlays, music, or extra characters not described above.",
  );
  parts.push("Do not skip steps.");
  parts.push("");

  // 10. END STATE
  parts.push("END STATE:");
  parts.push(config.endState);
  parts.push("");

  // 11. Footer
  const aspectRatio = "16:9"; // fixed per project config
  parts.push(
    `Total: ${config.totalDuration}s / ${config.shots.length} shots / ${aspectRatio}`,
  );

  return parts.join("\n");
}
