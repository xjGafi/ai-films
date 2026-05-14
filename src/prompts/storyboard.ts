import type { CharacterSpec, ShotSpec, VideoStyle } from "../types.js";

/**
 * Build an image generation prompt for a storyboard grid.
 * Grid size adapts to the number of shots; continuity from previous act's last shot is optional.
 */

const STYLE_KEYWORDS: Record<VideoStyle, string> = {
  cinematic:
    "Rough pencil storyboard sketch on textured cream paper. Graphite smudges, production pencil marks, red framing lines. Cinematic framing, 35mm film composition sensibility.",
  anime:
    "Clean anime storyboard sketch style. Bold ink outlines with light pencil shading, anime composition sensibility, impact lines where appropriate.",
  "3d-pixar":
    "Pixar-style storyboard sketch. Rounded forms, expressive gesture drawings, warm production-board aesthetic. Black and white pencil on cream paper.",
};

export interface StoryboardContinuity {
  lastShot: ShotSpec;
  lastShotDescription?: string;
}

export function buildStoryboardPrompt(
  shots: ShotSpec[],
  characters: CharacterSpec[],
  style: string,
  grid: { cols: number; rows: number },
  continuity?: StoryboardContinuity,
  actNum?: number,
): string {
  const styleKey = style as VideoStyle;
  const styleBlock = STYLE_KEYWORDS[styleKey] ?? STYLE_KEYWORDS["cinematic"];

  const totalPanels = grid.cols * grid.rows;
  const panelShots = shots.slice(0, totalPanels);

  // Build character reference block
  const characterBlock = characters
    .map((c) => `- ${c.name}: ${c.detail}`)
    .join("\n");

  // Build continuity block for previous act's last shot
  let continuityBlock = "";
  if (continuity) {
    const last = continuity.lastShot;
    continuityBlock = `\nCONTINUITY FROM PREVIOUS SCENE:\nThe last panel of the previous act shows: [${last.type}] ${last.action}${last.emotion ? ` (Emotion: ${last.emotion})` : ""}${continuity.lastShotDescription ? `\nVisual: ${continuity.lastShotDescription}` : ""}\nPanel 1 MUST flow naturally from this moment — same characters, same location, consistent blocking.\n`;
  }

  // Build panel descriptions
  const panelBlock = panelShots
    .map((shot, i) => {
      const panelNum = i + 1;
      const parts: string[] = [];

      const header = `PANEL ${panelNum}`;
      const shotType = shot.type ? `[${shot.type}]` : "";
      const camera = shot.camera ? `Camera: ${shot.camera}` : "";
      const title = shot.title ? `"${shot.title}"` : "";

      parts.push(header);
      if (title || shotType) {
        parts.push(`${title} ${shotType}`.trim());
      }
      if (camera) {
        parts.push(camera);
      }
      parts.push(shot.action);
      if (shot.emotion) {
        parts.push(`Emotion: ${shot.emotion}`);
      }

      return parts.join(" — ");
    })
    .join("\n\n");

  // Annotation color system (per tech guide §3.1 recommendation)
  const annotationBlock = `Annotation color system (drawn OVER the sketch, do not render as scene content):
- red arrows = character body movement direction
- blue arrows = camera movement direction
- green marks = framing / composition notes
- orange marks = lighting direction
- purple marks = emotional emphasis
- black text = shot type labels and panel numbers

No timestamps in panels.`;

  const seriesAnchor =
    actNum !== undefined && actNum > 1
      ? `This is act ${actNum} in a multi-act storyboard series. Maintain IDENTICAL visual style to previous acts: same paper texture, same line weight, same color palette, same character design proportions.\n\n`
      : "";

  return `${seriesAnchor}Generate a ${panelShots.length}-panel cinematic storyboard in a ${grid.cols}-column x ${grid.rows}-row grid layout.
Each panel is framed 16:9. The drawings themselves must be black and white only: rough pencil lines, minimal detail, fast gesture drawing energy, simple anatomy construction and strong silhouette readability.

${styleBlock}

Characters (maintain EXACT appearance across all panels):
${characterBlock}
${continuityBlock}
PANELS (read left to right, top to bottom):

${panelBlock}

Every panel must contain visible motion and strong body momentum. Avoid static standing poses.

${annotationBlock}

Panel numbers (1-${panelShots.length}) in the top-left corner of each panel. Brief shot-type label below each panel.`;
}
