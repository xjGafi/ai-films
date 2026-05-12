import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  buildStoryboardPrompt,
  type StoryboardContinuity,
} from "../../prompts/storyboard.js";
import { generateImage, saveBuffer } from "../../providers/volcengine.js";
import type { Screenplay, StageResult } from "../../types.js";
import type { ProjectState } from "../state.js";

const GRID_COLS = 3;
const GRID_ROWS = 3;

/**
 * Stage 2: Generate storyboard images and crop row strips.
 *
 * For each act in the screenplay:
 * - Generate a fixed 4×3 grid storyboard image.
 * - Crop 3 horizontal row strips from the grid.
 * - Place each strip on a 1920×1080 16:9 canvas (letterboxed).
 * - Pass continuity info (last shot of previous act) to the next act's prompt.
 */
export async function runStoryboardStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  const screenplayPath = path.join(projectDir, "screenplay.json");
  const raw = fs.readFileSync(screenplayPath, "utf-8");
  const screenplay: Screenplay = JSON.parse(raw);

  const artifacts: Record<string, string> = {};

  const storyboardDir = path.join(projectDir, "storyboard");
  if (!fs.existsSync(storyboardDir))
    fs.mkdirSync(storyboardDir, { recursive: true });

  let continuity: StoryboardContinuity | undefined;

  for (const act of screenplay.acts) {
    const actNum = act.act;

    const rawPath = path.join(storyboardDir, `act-${actNum}-raw.png`);
    const rawArtifactKey = `storyboard/act-${actNum}-raw.png`;

    const prompt = buildStoryboardPrompt(
      act.shots,
      screenplay.characters,
      state.config.style,
      { cols: GRID_COLS, rows: GRID_ROWS },
      continuity,
    );

    // Request 1920×1920 — meets API minimum pixel requirement and gives square cells
    const buffer = await generateImage(prompt, { size: "1920x1920" });
    saveBuffer(buffer, rawPath);
    artifacts[rawArtifactKey] = `storyboard/act-${actNum}-raw.png`;

    // Read actual image dimensions
    const metadata = await sharp(rawPath).metadata();
    const actualW = metadata.width ?? 1920;
    const actualH = metadata.height ?? 1920;
    const rowH = Math.floor(actualH / GRID_ROWS);

    // Crop 3 row strips, place each on 1920×1080 canvas
    for (let rowIdx = 0; rowIdx < GRID_ROWS; rowIdx++) {
      const rowNum = rowIdx + 1;
      const top = rowIdx * rowH;
      const stripH = rowIdx === GRID_ROWS - 1 ? actualH - top : rowH;

      const rowPath = path.join(
        storyboardDir,
        `act-${actNum}-row-${rowNum}.png`,
      );
      const rowArtifactKey = `storyboard/act-${actNum}-row-${rowNum}.png`;

      await sharp(rawPath)
        .extract({ left: 0, top, width: actualW, height: stripH })
        .resize(1920, 1080, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        })
        .png()
        .toFile(rowPath);

      artifacts[rowArtifactKey] = `storyboard/act-${actNum}-row-${rowNum}.png`;
    }

    continuity = {
      lastShot: act.shots[act.shots.length - 1],
      lastShotDescription: `End of Act ${actNum}`,
    };
  }

  return { artifacts };
}
