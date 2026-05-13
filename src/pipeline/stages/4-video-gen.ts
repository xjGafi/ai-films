import fs from "node:fs";
import path from "node:path";
import { VIDEO_MAX_RETRIES, VIDEO_SEGMENT_DURATION } from "../../config.js";
import { buildSeedancePrompt } from "../../prompts/video-shot.js";
import { extractLastFrame, getVideoDuration } from "../../providers/ffmpeg.js";
import type {
  VideoResult,
  VideoTaskParams,
} from "../../providers/volcengine.js";
import {
  downloadFile,
  imagePathToDataUri,
  pollVideoTask,
  submitVideoTask,
} from "../../providers/volcengine.js";
import type {
  ClipInfo,
  SceneSpec,
  Screenplay,
  StageResult,
  VideoPromptConfig,
} from "../../types.js";
import type { ProjectState } from "../state.js";

function getPrimaryScene(shots: Array<{ scene?: string }>): string | undefined {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    if (shot.scene) counts.set(shot.scene, (counts.get(shot.scene) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Submit a video task (retry on submit failure), then poll for the result
 * (retry on transient network errors, reusing the same taskId).
 * Exposed for testing — inject stub submitFn/pollFn to simulate failures.
 */
export async function submitAndPoll(
  segmentId: number,
  params: VideoTaskParams,
  maxRetries = VIDEO_MAX_RETRIES,
  submitFn: (p: VideoTaskParams) => Promise<string> = submitVideoTask,
  pollFn: (id: string) => Promise<VideoResult> = pollVideoTask,
): Promise<VideoResult> {
  // --- Submit (retry only on submit failure) ---
  let taskId: string | undefined;
  let submitError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[video-gen] segment ${segmentId}: attempt ${attempt}/${maxRetries}`,
      );
      taskId = await submitFn(params);
      console.log(`[video-gen] segment ${segmentId}: taskId=${taskId}`);
      break;
    } catch (err) {
      submitError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[video-gen] segment ${segmentId}: attempt ${attempt} failed — ${submitError.message}`,
      );
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  if (!taskId) {
    throw new Error(
      `Video submit failed for segment ${segmentId} after ${maxRetries} attempts: ${submitError?.message}`,
    );
  }

  // --- Poll (retry transient network errors, same taskId) ---
  let pollError: Error | undefined;
  for (let pollAttempt = 1; pollAttempt <= maxRetries; pollAttempt++) {
    try {
      return await pollFn(taskId);
    } catch (err) {
      pollError = err instanceof Error ? err : new Error(String(err));
      const isTerminal =
        pollError.message.startsWith("Video task failed:") ||
        pollError.message.includes("no URL found") ||
        pollError.message.startsWith("Video task timed out");
      if (isTerminal) throw pollError;
      console.error(
        `[video-gen] segment ${segmentId}: poll attempt ${pollAttempt} failed — ${pollError.message}`,
      );
      if (pollAttempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw new Error(
    `Video poll failed for segment ${segmentId} after ${maxRetries} attempts: ${pollError?.message}`,
  );
}

export async function runVideoGenStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  const promptsDir = path.join(projectDir, "prompts");
  const clipsDir = path.join(projectDir, "clips");
  const framesDir = path.join(projectDir, "frames");

  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

  // Build scene ref lookup
  const scenesDir = path.join(projectDir, "scenes");
  const sceneRefMap = new Map<string, string>();
  if (fs.existsSync(scenesDir)) {
    for (const f of fs.readdirSync(scenesDir)) {
      if (f.endsWith("-ref.png")) {
        sceneRefMap.set(f.replace("-ref.png", ""), path.join(scenesDir, f));
      }
    }
  }

  const screenplayRaw = fs.readFileSync(
    path.join(projectDir, "screenplay.json"),
    "utf-8",
  );
  const screenplay: Screenplay = JSON.parse(screenplayRaw);
  const sceneSpecMap = new Map<string, SceneSpec>(
    (screenplay.scenes ?? []).map((s) => [s.id, s]),
  );

  // 1. Read all segment prompt files and sort by ID
  const promptFiles = fs
    .readdirSync(promptsDir)
    .filter((f) => /^segment-\d+\.json$/.test(f))
    .sort((a, b) => {
      const numA = Number(a.match(/segment-(\d+)\.json/)?.[1] ?? 0);
      const numB = Number(b.match(/segment-(\d+)\.json/)?.[1] ?? 0);
      return numA - numB;
    });

  if (promptFiles.length === 0) {
    throw new Error(`No segment prompt files found in ${promptsDir}`);
  }

  const artifacts: Record<string, string> = {};

  // 2. Process each segment
  for (const file of promptFiles) {
    const segmentId = Number(file.match(/segment-(\d+)\.json/)?.[1] ?? 0);
    const config: VideoPromptConfig = JSON.parse(
      fs.readFileSync(path.join(promptsDir, file), "utf-8"),
    );

    // a. Build the prompt text
    const promptText = buildSeedancePrompt(config);

    // b. Build VideoTaskParams
    const duration = Math.min(config.totalDuration, VIDEO_SEGMENT_DURATION);
    const params: VideoTaskParams = {
      prompt: promptText,
      duration,
      resolution: state.config.resolution,
      aspect_ratio: state.config.aspectRatio,
      seed: config.seed,
    };

    if (config.mode === "modeA") {
      // TODO: The API likely requires URLs, not local file paths.
      // When an upload/URL mechanism is available, convert these paths to URLs first.
      if (config.imageRef) params.image = config.imageRef;
      if (config.lastFrameRef) params.last_frame_image = config.lastFrameRef;
    } else if (config.mode === "modeB") {
      if (config.referenceImageRefs?.length) {
        params.reference_images =
          config.referenceImageRefs.map(imagePathToDataUri);
      }
    }

    // c. Generate video with independent submit/poll retry
    const result = await submitAndPoll(segmentId, params);

    // d. Download video
    const clipPath = path.join(clipsDir, `segment-${segmentId}.mp4`);
    await downloadFile(result.url, clipPath);

    // e. Extract last frame
    const lastFramePath = path.join(framesDir, `segment-${segmentId}-last.png`);
    await extractLastFrame(clipPath, lastFramePath);

    // f. Get actual video duration
    const actualDuration = await getVideoDuration(clipPath);

    // g. Build ClipInfo and save
    const clipInfo: ClipInfo = {
      segmentId,
      filePath: `clips/segment-${segmentId}.mp4`,
      lastFramePath: `frames/segment-${segmentId}-last.png`,
      duration: actualDuration,
      taskId: result.taskId,
    };

    const infoPath = path.join(clipsDir, `segment-${segmentId}-info.json`);
    fs.writeFileSync(infoPath, JSON.stringify(clipInfo, null, 2), "utf-8");

    // h. Inject last frame + enhanced continuity into next segment's prompt
    const nextPromptPath = path.join(
      promptsDir,
      `segment-${segmentId + 1}.json`,
    );
    if (fs.existsSync(nextPromptPath)) {
      const nextConfig: VideoPromptConfig = JSON.parse(
        fs.readFileSync(nextPromptPath, "utf-8"),
      );
      const alreadyHas = nextConfig.referenceImageRefs?.some((r) =>
        r.endsWith(`segment-${segmentId}-last.png`),
      );
      if (!alreadyHas) {
        // 1. Prepend last frame + prev row-3 to referenceImageRefs
        const storyboardDir = path.join(projectDir, "storyboard");
        const currentActNumber = segmentId; // acts and segments are 1:1
        const prevRow3Path = path.join(
          storyboardDir,
          `act-${currentActNumber}-row-3.png`,
        );
        const prevRow3Exists = fs.existsSync(prevRow3Path);
        const existingRefs = nextConfig.referenceImageRefs ?? [];
        const newRefs: string[] = [lastFramePath];
        if (prevRow3Exists) {
          newRefs.push(prevRow3Path);
        }

        // Inject scene ref if Stage 3 did not already include it
        const nextPrimaryScene = getPrimaryScene(nextConfig.shots);
        const nextSceneRefPath = nextPrimaryScene
          ? sceneRefMap.get(nextPrimaryScene)
          : undefined;
        const needsSceneRefInjection =
          nextSceneRefPath !== undefined &&
          fs.existsSync(nextSceneRefPath) &&
          !existingRefs.some((r) => r === nextSceneRefPath);
        if (needsSceneRefInjection) {
          newRefs.push(nextSceneRefPath);
        }

        nextConfig.referenceImageRefs = [...newRefs, ...existingRefs];

        // 2. Rebuild referenceDesc with enhanced Image1 + optional Image2, shift existing indices
        const shiftCount = newRefs.length;
        const shiftedDesc = nextConfig.referenceDesc.replace(
          /\[Image(\d+)\]/g,
          (_, n) => `[Image${Number(n) + shiftCount}]`,
        );
        const descParts: string[] = [
          `[Image1] is the EXACT last frame of the previous clip. Your opening frames MUST match this image — same background, same lighting, same color palette, same character positions, same camera angle. This is the highest-priority reference.`,
        ];
        if (prevRow3Exists) {
          descParts.push(
            `[Image2] is the storyboard strip for the ENDING of the previous act — use to maintain environment consistency (walls, furniture, lighting direction).`,
          );
        }
        if (needsSceneRefInjection && nextPrimaryScene) {
          const sceneSpec = sceneSpecMap.get(nextPrimaryScene);
          const label = sceneSpec?.name ?? nextPrimaryScene;
          descParts.push(
            `[Image${descParts.length + 1}] is the reference environment for scene "${label}" — match this exact room layout, wall colors, lighting, and spatial arrangement throughout all shots.`,
          );
        }
        descParts.push(shiftedDesc);
        nextConfig.referenceDesc = descParts.join("\n");

        // 3. Replace continuityNote with enhanced scene-aware version
        const currentLastShot = config.shots[config.shots.length - 1];
        const nextFirstShot = nextConfig.shots[0];
        const sameScene =
          currentLastShot?.scene &&
          nextFirstShot?.scene &&
          currentLastShot.scene === nextFirstShot.scene;
        if (sameScene) {
          nextConfig.continuityNote = [
            "VISUAL CONTINUITY — SAME SCENE:",
            "[Image1] shows exactly where the previous clip ended. Your opening frames must match:",
            "• Background: identical walls, furniture, objects, spatial layout",
            "• Lighting: same direction, intensity, and color temperature",
            "• Camera: same angle and distance from subjects",
            "• Characters: same positions and poses as shown in [Image1]",
            `Action continues from: ${currentLastShot.action}`,
          ].join("\n");
        } else {
          nextConfig.continuityNote = [
            "VISUAL CONTINUITY — SCENE TRANSITION:",
            "[Image1] shows the previous clip's ending. Transition smoothly to the new scene while:",
            "• Maintaining consistent character appearance and costume",
            "• Using a natural transition (the character walks/turns to reveal the new environment)",
            `Action continues from: ${currentLastShot?.action ?? "the previous scene"}`,
          ].join("\n");
        }

        // 4. Append hard continuity rule if not already present
        const continuityRule =
          "The first 2 seconds of this clip must be visually continuous with [Image1] — match the background, lighting, color temperature, and character positions exactly.";
        if (!nextConfig.rules.includes(continuityRule)) {
          nextConfig.rules.push(continuityRule);
        }

        // 5. Rebuild prompt and save
        const updatedPrompt = buildSeedancePrompt(nextConfig);
        fs.writeFileSync(
          nextPromptPath,
          JSON.stringify({ ...nextConfig, prompt: updatedPrompt }, null, 2),
          "utf-8",
        );
        console.log(
          `[video-gen] injected last frame + continuity layers of segment ${segmentId} into segment ${segmentId + 1} prompts`,
        );
      }
    }

    // i. Record artifacts
    artifacts[`clip-${segmentId}`] = `clips/segment-${segmentId}.mp4`;
    artifacts[`frame-${segmentId}-last`] =
      `frames/segment-${segmentId}-last.png`;
    artifacts[`clip-${segmentId}-info`] =
      `clips/segment-${segmentId}-info.json`;

    console.log(
      `[video-gen] segment ${segmentId}: done (${actualDuration.toFixed(2)}s)`,
    );
  }

  return { artifacts };
}
