import fs from "node:fs";
import path from "node:path";
import { VIDEO_MAX_RETRIES, VIDEO_SEGMENT_DURATION } from "../../config.js";
import { buildSeedancePrompt } from "../../prompts/video-shot.js";
import { extractLastFrame, getVideoDuration } from "../../providers/ffmpeg.js";
import type { VideoTaskParams } from "../../providers/volcengine.js";
import {
  downloadFile,
  imagePathToDataUri,
  pollVideoTask,
  submitVideoTask,
} from "../../providers/volcengine.js";
import type { ClipInfo, StageResult, VideoPromptConfig } from "../../types.js";
import type { ProjectState } from "../state.js";

export async function runVideoGenStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  const promptsDir = path.join(projectDir, "prompts");
  const clipsDir = path.join(projectDir, "clips");
  const framesDir = path.join(projectDir, "frames");

  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

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

    // c. Generate video with retry logic
    let lastError: Error | undefined;
    let result: Awaited<ReturnType<typeof pollVideoTask>> | undefined;

    for (let attempt = 1; attempt <= VIDEO_MAX_RETRIES; attempt++) {
      try {
        console.log(
          `[video-gen] segment ${segmentId}: attempt ${attempt}/${VIDEO_MAX_RETRIES}`,
        );
        const taskId = await submitVideoTask(params);
        console.log(`[video-gen] segment ${segmentId}: taskId=${taskId}`);
        result = await pollVideoTask(taskId);
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(
          `[video-gen] segment ${segmentId}: attempt ${attempt} failed — ${lastError.message}`,
        );
        if (attempt < VIDEO_MAX_RETRIES) {
          // Brief pause before retry
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    if (!result) {
      throw new Error(
        `Video generation failed for segment ${segmentId} after ${VIDEO_MAX_RETRIES} attempts: ${lastError?.message}`,
      );
    }

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

    // h. Record artifacts
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
