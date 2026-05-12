import fs from "node:fs";
import path from "node:path";
import { buildScreenplayPrompt } from "../../prompts/screenplay.js";
import { chat } from "../../providers/volcengine.js";
import type { Screenplay, StageResult } from "../../types.js";
import type { ProjectState } from "../state.js";

/**
 * Stage 0: Generate a structured screenplay via LLM.
 *
 * Reads config (story, characters, duration, style), calls the LLM to produce
 * a Screenplay JSON, validates the shape, and persists it to screenplay.json.
 */
export async function runScreenplayStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  const { story, characters, duration, style } = state.config;

  // 1. Build prompt messages
  const messages = buildScreenplayPrompt(story, characters, duration, style);

  // 2. Call LLM with JSON output mode
  // numActs × 9 shots each; screenplay JSON can exceed 8k tokens
  const raw = await chat(messages, {
    responseFormat: { type: "json_object" },
    maxTokens: 16384,
  });

  // 3. Parse and validate
  let screenplay: Screenplay;
  try {
    screenplay = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse screenplay JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Basic structural validation
  if (!screenplay.title || typeof screenplay.totalDuration !== "number") {
    throw new Error("Screenplay missing required fields: title, totalDuration");
  }
  if (!Array.isArray(screenplay.acts) || screenplay.acts.length === 0) {
    throw new Error("Screenplay must contain at least one act");
  }
  for (const act of screenplay.acts) {
    if (!Array.isArray(act.shots) || act.shots.length === 0) {
      throw new Error(`Act ${act.act} must contain at least one shot`);
    }
    if (act.shots.length !== 9) {
      throw new Error(
        `Act ${act.act} has ${act.shots.length} shots but must have exactly 9`,
      );
    }
  }
  if (!Array.isArray(screenplay.characters)) {
    throw new Error("Screenplay must contain a characters array");
  }
  if (!Array.isArray(screenplay.transitionHints)) {
    throw new Error("Screenplay must contain a transitionHints array");
  }

  // 4. Save screenplay
  const outPath = path.join(projectDir, "screenplay.json");
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(screenplay, null, 2), "utf-8");

  return { artifacts: { screenplay: "screenplay.json" } };
}
