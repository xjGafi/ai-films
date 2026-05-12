import fs from "node:fs";
import path from "node:path";
import type { ClipSpec } from "../../providers/ffmpeg.js";
import { concatenateClips } from "../../providers/ffmpeg.js";
import type { AssemblyPlan, StageResult } from "../../types.js";
import type { ProjectState } from "../state.js";

export async function runAssemblyStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  // 1. Load assembly plan
  const planPath = path.join(projectDir, "assembly-plan.json");
  if (!fs.existsSync(planPath)) {
    throw new Error("Assembly plan not found at " + planPath);
  }

  const plan: AssemblyPlan = JSON.parse(fs.readFileSync(planPath, "utf-8"));

  if (plan.clips.length === 0) {
    throw new Error("Assembly plan contains no clips");
  }

  // 2. Build ClipSpec array from the plan
  const clips: ClipSpec[] = plan.clips.map((clip, index) => {
    const clipPath = path.resolve(projectDir, clip.filePath);

    if (!fs.existsSync(clipPath)) {
      throw new Error(
        `Clip file not found for segment ${clip.segmentId}: ${clipPath}`,
      );
    }

    // Map the transition that follows this clip (transitions[i] goes after clips[i])
    // concatenateClips expects the transition on the *receiving* clip (index > 0),
    // matching the ffmpeg.ts convention: clips[i].transition applies to the join
    // between clip i-1 and clip i.
    const transition = index > 0 ? plan.transitions[index - 1] : undefined;

    return {
      path: clipPath,
      duration: clip.duration,
      transition,
    };
  });

  // 3. Ensure output directory exists and assemble
  const outputPath = path.resolve(projectDir, plan.outputPath);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(
    `[assembly] concatenating ${clips.length} clips → ${plan.outputPath}`,
  );

  await concatenateClips(clips, outputPath);

  console.log(`[assembly] done: ${outputPath}`);

  // 4. Return artifacts
  return {
    artifacts: {
      "final-video": plan.outputPath,
    },
  };
}
