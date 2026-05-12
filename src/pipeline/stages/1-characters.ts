import fs from "node:fs";
import path from "node:path";
import { buildCharacterSheetPrompt } from "../../prompts/character-sheet.js";
import { generateImage, saveBuffer } from "../../providers/volcengine.js";
import type { Screenplay, StageResult } from "../../types.js";
import type { ProjectState } from "../state.js";

/**
 * Stage 1: Generate character reference sheets.
 *
 * For each character in the screenplay:
 * - If the user provided an imagePath, copy it as the reference.
 * - Otherwise, generate a character sheet image via the image API.
 *
 * All references are saved as characters/{name}-ref.png.
 */
export async function runCharactersStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  // 1. Load screenplay
  const screenplayPath = path.join(projectDir, "screenplay.json");
  const raw = fs.readFileSync(screenplayPath, "utf-8");
  const screenplay: Screenplay = JSON.parse(raw);

  const artifacts: Record<string, string> = {};

  // 2. Build a lookup from config character inputs (by name) for imagePath
  const configCharMap = new Map(
    state.config.characters.map((c) => [c.name, c.imagePath]),
  );

  // 3. Process each character
  for (const char of screenplay.characters) {
    const refFileName = `${char.name}-ref.png`;
    const outPath = path.join(projectDir, "characters", refFileName);
    const artifactKey = `characters/${refFileName}`;

    // Ensure output directory exists
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const providedImagePath = configCharMap.get(char.name);

    if (providedImagePath && fs.existsSync(providedImagePath)) {
      // User provided a reference image — copy it
      fs.copyFileSync(providedImagePath, outPath);
    } else {
      // Generate a character sheet
      const prompt = buildCharacterSheetPrompt(char, state.config.style);
      const buffer = await generateImage(prompt, { seed: state.config.seed });
      saveBuffer(buffer, outPath);
    }

    artifacts[artifactKey] = `characters/${refFileName}`;
  }

  return { artifacts };
}
