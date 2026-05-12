import fs from "node:fs";
import path from "node:path";
import { CROSSFADE_DURATION } from "../../config.js";
import type {
  AssemblyPlan,
  AssemblyTransition,
  ClipInfo,
  StageResult,
  VideoPromptConfig,
} from "../../types.js";
import type { ProjectState } from "../state.js";

export async function runTransitionsStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  const promptsDir = path.join(projectDir, "prompts");
  const clipsDir = path.join(projectDir, "clips");

  // 1. Read all segment prompt files to get transition strategies
  const promptFiles = fs
    .readdirSync(promptsDir)
    .filter((f) => /^segment-\d+\.json$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/segment-(\d+)\.json/)![1], 10);
      const numB = parseInt(b.match(/segment-(\d+)\.json/)![1], 10);
      return numA - numB;
    });

  if (promptFiles.length === 0) {
    throw new Error("No segment prompt files found in " + promptsDir);
  }

  // 2. Read all clip info files to get durations
  const clipInfoFiles = fs
    .readdirSync(clipsDir)
    .filter((f) => /^segment-\d+-info\.json$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/segment-(\d+)-info\.json/)![1], 10);
      const numB = parseInt(b.match(/segment-(\d+)-info\.json/)![1], 10);
      return numA - numB;
    });

  if (clipInfoFiles.length === 0) {
    throw new Error("No clip info files found in " + clipsDir);
  }

  // 3. Sort by segment ID (already sorted above)
  const clips: ClipInfo[] = clipInfoFiles.map((f) => {
    const raw = fs.readFileSync(path.join(clipsDir, f), "utf-8");
    return JSON.parse(raw) as ClipInfo;
  });

  // Build a map of segmentId → transition strategy from prompt configs
  const strategyMap = new Map<number, string>();
  for (const file of promptFiles) {
    const segmentId = parseInt(file.match(/segment-(\d+)\.json/)![1], 10);
    const config: VideoPromptConfig = JSON.parse(
      fs.readFileSync(path.join(promptsDir, file), "utf-8"),
    );
    strategyMap.set(segmentId, config.transitionStrategy);
  }

  // 4. Build AssemblyPlan
  const transitions: AssemblyTransition[] = [];

  for (let i = 0; i < clips.length - 1; i++) {
    const currentClip = clips[i];
    const nextClip = clips[i + 1];
    const strategy =
      strategyMap.get(nextClip.segmentId) ?? "continuity_crossfade";

    const transition: AssemblyTransition = {
      afterSegment: currentClip.segmentId,
      strategy: strategy as AssemblyTransition["strategy"],
    };

    switch (strategy) {
      case "continuity_crossfade":
        transition.crossfadeDuration = CROSSFADE_DURATION;
        break;

      case "first_frame_anchor":
        // Verify that previous segment has a lastFramePath
        if (!currentClip.lastFramePath) {
          throw new Error(
            `first_frame_anchor transition after segment ${currentClip.segmentId} requires a lastFramePath, but none found`,
          );
        }
        break;

      case "occlusion_transition":
      case "hard_cut":
        // No special parameters needed
        break;

      default:
        // Unknown strategy — default to continuity_crossfade
        transition.strategy = "continuity_crossfade";
        transition.crossfadeDuration = CROSSFADE_DURATION;
        break;
    }

    transitions.push(transition);
  }

  const assemblyPlan: AssemblyPlan = {
    clips,
    transitions,
    outputPath: "output/final.mp4",
  };

  // 5. Save assembly plan
  const planPath = path.join(projectDir, "assembly-plan.json");
  fs.writeFileSync(planPath, JSON.stringify(assemblyPlan, null, 2), "utf-8");

  console.log(
    `[transitions] assembly plan created with ${clips.length} clips and ${transitions.length} transitions`,
  );

  // 6. Return artifacts
  return {
    artifacts: {
      "assembly-plan": "assembly-plan.json",
    },
  };
}
