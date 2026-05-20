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
import type { ClipInfo, StageResult, VideoPromptConfig } from "../../types.js";
import type { ProjectState } from "../state.js";

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
        // 1. Prepend last frame to referenceImageRefs
        const existingRefs = nextConfig.referenceImageRefs ?? [];
        nextConfig.referenceImageRefs = [lastFramePath, ...existingRefs];

        // 2. 更新 materialDesc 和 constraints — 已有索引全部 +1，再插入衔接参考行
        const shiftRefs = (s: string) =>
          s.replace(/@图片(\d+)/g, (_, n) => `@图片${Number(n) + 1}`);

        if (nextConfig.materialDesc) {
          const shiftedMaterial = shiftRefs(nextConfig.materialDesc);
          const insertLine = "@图片1 作为衔接参考，这是上一段的最后一帧。";
          nextConfig.materialDesc = shiftedMaterial.replace(
            "【素材说明】\n",
            `【素材说明】\n${insertLine}\n`,
          );
        }

        if (nextConfig.constraints) {
          nextConfig.constraints = shiftRefs(nextConfig.constraints);
        }

        // 3. 重建 continuityNote
        const currentLastShot = config.shots[config.shots.length - 1];
        const nextFirstShot = nextConfig.shots[0];
        const sameScene =
          currentLastShot?.scene &&
          nextFirstShot?.scene &&
          currentLastShot.scene === nextFirstShot.scene;

        if (sameScene) {
          nextConfig.continuityNote = [
            "【衔接要求】",
            "@图片1 是上一段的结尾画面。开场必须与此画面完全一致：",
            "• 相同背景、家具、物体、空间布局",
            "• 相同光线方向、强度和色温",
            "• 相同镜头角度和距离",
            "• 角色位置和姿态与参考图一致",
            `前段结尾动作：${currentLastShot.action}`,
          ].join("\n");
        } else {
          nextConfig.continuityNote = [
            "【衔接要求】",
            "@图片1 是上一段的结尾画面。平滑过渡到新场景：",
            "• 保持角色外观和服装一致",
            "• 使用自然过渡（角色转身/行走，揭示新环境）",
            `前段结尾动作：${currentLastShot?.action ?? "上一场景"}`,
          ].join("\n");
        }

        // 4. 重建 prompt 并保存
        const updatedPrompt = buildSeedancePrompt(nextConfig);
        fs.writeFileSync(
          nextPromptPath,
          JSON.stringify({ ...nextConfig, prompt: updatedPrompt }, null, 2),
          "utf-8",
        );
        console.log(
          `[video-gen] 已注入 segment ${segmentId} 的最后一帧到 segment ${segmentId + 1} 的提示词`,
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
