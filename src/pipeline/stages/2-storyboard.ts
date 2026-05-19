import fs from "node:fs";
import path from "node:path";
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
 * Stage 2: Generate storyboard images.
 *
 * For each act in the screenplay:
 * - Generate a fixed 3×3 grid storyboard image (1920×1920).
 * - Pass continuity info (last shot of previous act) to the next act's prompt.
 * - The raw grid is used directly by Stage 3 as a reference image for Seedance.
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
      actNum,
    );

    // Request 1920×1920 — meets API minimum pixel requirement and gives square cells
    const buffer = await generateImage(prompt, { size: "1920x1920" });
    saveBuffer(buffer, rawPath);
    artifacts[rawArtifactKey] = `storyboard/act-${actNum}-raw.png`;

    continuity = {
      lastShot: act.shots[act.shots.length - 1],
      lastShotDescription: `End of Act ${actNum}`,
    };
  }

  return { artifacts };
}
