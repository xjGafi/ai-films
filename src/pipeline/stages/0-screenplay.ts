import fs from "node:fs";
import path from "node:path";
import { buildScreenplayPrompt } from "../../prompts/screenplay.js";
import { chat } from "../../providers/volcengine.js";
import type { ActSpec, Screenplay, StageResult } from "../../types.js";
import type { ProjectState } from "../state.js";

const PACE_WEIGHTS: Record<string, number> = {
  slow: 2.5,
  medium: 1.67,
  fast: 1.0,
};
const DEFAULT_PACE_WEIGHT = PACE_WEIGHTS.medium;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function assignShotTimestamps(acts: ActSpec[]): void {
  let cursor = 0;
  for (const act of acts) {
    const weights = act.shots.map(
      (s) => PACE_WEIGHTS[s.pace ?? "medium"] ?? DEFAULT_PACE_WEIGHT,
    );
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < act.shots.length; i++) {
      const duration = (weights[i] / totalWeight) * act.durationTarget;
      const start = cursor;
      cursor += duration;
      act.shots[i].time = `${formatTime(start)}-${formatTime(cursor)}`;
    }
  }
}

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
  const { story, characters, duration, style, scenes } = state.config;

  // 1. Build prompt messages
  const messages = buildScreenplayPrompt(
    story,
    characters,
    duration,
    style,
    scenes,
  );

  // 2. Call LLM with JSON output mode
  // numActs × 9 shots each; screenplay JSON can exceed 8k tokens
  const raw = await chat(messages, {
    maxTokens: 16384,
  });

  // 3. Parse and validate
  // Strip markdown code fences if model wrapped the output
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let screenplay: Screenplay;
  try {
    screenplay = JSON.parse(cleaned);
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
  if (!Array.isArray(screenplay.scenes) || screenplay.scenes.length === 0) {
    throw new Error("Screenplay must contain a non-empty scenes array");
  }
  const sceneIds = new Set(screenplay.scenes.map((s) => s.id));
  for (const act of screenplay.acts) {
    for (const shot of act.shots) {
      if (shot.scene && !sceneIds.has(shot.scene)) {
        throw new Error(
          `Act ${act.act} shot ${shot.id}: scene "${shot.scene}" not found in scenes array`,
        );
      }
    }
  }

  const actDurationSum = screenplay.acts.reduce(
    (sum, a) => sum + a.durationTarget,
    0,
  );
  if (actDurationSum !== screenplay.totalDuration) {
    throw new Error(
      `Act durationTargets sum to ${actDurationSum}s but totalDuration is ${screenplay.totalDuration}s`,
    );
  }

  assignShotTimestamps(screenplay.acts);

  // 5. Force-override character and scene fields from config inputs
  //    Ensures LLM output doesn't drift from the canonical input descriptions/ids.
  const charInputMap = new Map(state.config.characters.map((c) => [c.name, c]));
  for (const charSpec of screenplay.characters) {
    const inputChar = charInputMap.get(charSpec.name);
    if (inputChar?.detail) {
      charSpec.detail = inputChar.detail;
    }
    if (inputChar?.id) {
      charSpec.id = inputChar.id;
    }
  }

  const sceneInputMap = new Map(
    (state.config.scenes ?? []).map((s) => [s.id, s]),
  );
  for (const sceneSpec of screenplay.scenes) {
    const inputScene = sceneInputMap.get(sceneSpec.id);
    if (inputScene?.detail) {
      sceneSpec.detail = inputScene.detail;
    }
  }

  // 6. Save screenplay
  const outPath = path.join(projectDir, "screenplay.json");
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(screenplay, null, 2), "utf-8");

  return { artifacts: { screenplay: "screenplay.json" } };
}
