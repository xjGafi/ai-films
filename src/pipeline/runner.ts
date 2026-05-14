import { closeLogger, initLogger, log } from "../logger.js";
import type { RunOptions, StageName, StageResult } from "../types.js";
import { STAGE_NAMES } from "../types.js";
import { ProjectState } from "./state.js";

// ── Stage handler imports ──

import { runScreenplayStage } from "./stages/0-screenplay.js";
import { runCharactersStage } from "./stages/1-characters.js";
import { runStoryboardStage } from "./stages/2-storyboard.js";
import { runPromptsStage } from "./stages/3-prompts.js";
import { runVideoGenStage } from "./stages/4-video-gen.js";
import { runTransitionsStage } from "./stages/5-transitions.js";
import { runAssemblyStage } from "./stages/6-assembly.js";

type StageHandler = (
  projectDir: string,
  state: ProjectState,
) => Promise<StageResult>;

const HANDLERS: Record<StageName, StageHandler> = {
  screenplay: runScreenplayStage,
  characters: runCharactersStage,
  storyboard: runStoryboardStage,
  prompts: runPromptsStage,
  "video-gen": runVideoGenStage,
  transitions: runTransitionsStage,
  assembly: runAssemblyStage,
};

// ── Pipeline runner ──

/**
 * Execute the AI Films pipeline for a project.
 *
 * 1. Loads ProjectState from `{projectDir}/state.json`.
 * 2. If `options.fromStage` is set, resets that stage and every subsequent
 *    stage back to "pending" so they re-run.
 * 3. Iterates through stages in order, skipping already-completed stages.
 * 4. For each stage to run: markInProgress → handler → markCompleted / recordError.
 * 5. Persists state after every stage.
 * 6. Stops on first failure.
 */
export async function runPipeline(
  projectDir: string,
  options?: RunOptions,
): Promise<void> {
  initLogger(projectDir);
  const state = ProjectState.load(projectDir);

  // If restarting from a specific stage, reset it and everything after.
  if (options?.fromStage) {
    state.resetFrom(options.fromStage);
    state.save();
    log("pipeline", `reset from stage: ${options.fromStage}`);
  }

  try {
    for (const stageName of STAGE_NAMES) {
      // Skip stages that are already done.
      if (state.isCompleted(stageName)) {
        continue;
      }

      console.log(`[${stageName}] starting...`);
      log("stage:start", stageName);
      state.markInProgress(stageName);
      state.save();

      try {
        const handler = HANDLERS[stageName];
        const result: StageResult = await handler(projectDir, state);
        state.markCompleted(stageName, result.artifacts);
        state.save();
        log("stage:complete", {
          stage: stageName,
          artifacts: result.artifacts,
        });
        console.log(`[${stageName}] completed`);

        if (options?.toStage && stageName === options.toStage) {
          console.log(`[pipeline] stopping after stage: ${stageName}`);
          break;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        state.recordError(stageName, message);
        state.save();
        log("stage:error", { stage: stageName, error: message });
        console.error(`[${stageName}] failed: ${message}`);
        break; // stop pipeline on first failure
      }
    }
  } finally {
    closeLogger();
  }
}
