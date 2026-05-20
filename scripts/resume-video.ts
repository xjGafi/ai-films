/**
 * 从指定 segment 续跑视频生成，然后拼接成最终 mp4。
 * 用法：tsx scripts/resume-video.ts <projectId> [startSegment]
 *   projectId:    projects/ 下的项目目录名
 *   startSegment: 从第几段开始（默认 2，即跳过已完成的 segment-1）
 */

import fs from "node:fs";
import path from "node:path";
import { runTransitionsStage } from "../src/pipeline/stages/5-transitions.js";
import { runAssemblyStage } from "../src/pipeline/stages/6-assembly.js";
import { ProjectState } from "../src/pipeline/state.js";
import { buildSeedancePrompt } from "../src/prompts/video-shot.js";
import { extractLastFrame, getVideoDuration } from "../src/providers/ffmpeg.js";
import {
  downloadFile,
  imagePathToDataUri,
  pollVideoTask,
  submitVideoTask,
} from "../src/providers/volcengine.js";
import type { VideoPromptConfig } from "../src/types.js";

const [, , projectId, startSegStr] = process.argv;
if (!projectId) {
  console.error("用法: tsx scripts/resume-video.ts <projectId> [startSegment]");
  process.exit(1);
}

const projectDir = path.resolve("projects", projectId);
if (!fs.existsSync(projectDir)) {
  console.error(`项目不存在: ${projectDir}`);
  process.exit(1);
}

const startSeg = Number(startSegStr ?? 2);
const promptsDir = path.join(projectDir, "prompts");
const clipsDir = path.join(projectDir, "clips");
const framesDir = path.join(projectDir, "frames");

fs.mkdirSync(clipsDir, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });

// 读取所有 segment prompt 文件，按编号排序
const allFiles = fs
  .readdirSync(promptsDir)
  .filter((f) => /^segment-\d+\.json$/.test(f))
  .sort((a, b) => {
    const na = Number(a.match(/segment-(\d+)/)?.[1] ?? 0);
    const nb = Number(b.match(/segment-(\d+)/)?.[1] ?? 0);
    return na - nb;
  });

const totalSegments = allFiles.length;
const pendingFiles = allFiles.filter((f) => {
  const n = Number(f.match(/segment-(\d+)/)?.[1] ?? 0);
  return n >= startSeg;
});

console.log(
  `项目: ${projectId}，共 ${totalSegments} 段，从 segment-${startSeg} 开始续跑 (${pendingFiles.length} 段待生成)`,
);

for (const file of pendingFiles) {
  const segmentId = Number(file.match(/segment-(\d+)/)?.[1] ?? 0);
  const configPath = path.join(promptsDir, file);
  const config: VideoPromptConfig = JSON.parse(
    fs.readFileSync(configPath, "utf-8"),
  );

  // 如果上一段的最后一帧还没注入到本段，先注入
  const prevLastFrame = path.join(
    framesDir,
    `segment-${segmentId - 1}-last.png`,
  );
  if (
    segmentId > 1 &&
    fs.existsSync(prevLastFrame) &&
    !config.referenceImageRefs?.some((r) =>
      r.endsWith(`segment-${segmentId - 1}-last.png`),
    )
  ) {
    const existingRefs = config.referenceImageRefs ?? [];
    config.referenceImageRefs = [prevLastFrame, ...existingRefs];

    if (
      config.materialDesc &&
      !config.materialDesc.includes("@图片 1 作为衔接参考")
    ) {
      const shifted = config.materialDesc.replace(
        /@图片 (\d+)/g,
        (_, n) => `@图片 ${Number(n) + 1}`,
      );
      config.materialDesc = shifted.replace(
        "【素材说明】\n",
        "【素材说明】\n@图片 1 作为衔接参考，这是上一段的最后一帧。\n",
      );
    }

    const updatedPrompt = buildSeedancePrompt(config);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ...config, prompt: updatedPrompt }, null, 2),
      "utf-8",
    );
    console.log(
      `[video-gen] 已注入 segment ${segmentId - 1} 的最后一帧到 segment ${segmentId}`,
    );
  }

  // 重新读 config（可能刚刚更新了）
  const freshConfig: VideoPromptConfig = JSON.parse(
    fs.readFileSync(configPath, "utf-8"),
  );
  const promptText = buildSeedancePrompt(freshConfig);

  const params = {
    prompt: promptText,
    duration: 15,
    resolution: "720p",
    aspect_ratio: "16:9",
    seed: freshConfig.seed,
    ...(freshConfig.mode === "modeB" && freshConfig.referenceImageRefs?.length
      ? {
          reference_images:
            freshConfig.referenceImageRefs.map(imagePathToDataUri),
        }
      : {}),
  };

  // Submit
  console.log(`[video-gen] segment ${segmentId}: submitting...`);
  const taskId = await submitVideoTask(params);
  console.log(`[video-gen] segment ${segmentId}: taskId=${taskId}`);

  // Poll（最多重试 3 次瞬时网络错误）
  let result: Awaited<ReturnType<typeof pollVideoTask>> | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await pollVideoTask(taskId);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTerminal =
        msg.startsWith("Video task failed:") ||
        msg.includes("no URL found") ||
        msg.startsWith("Video task timed out");
      if (isTerminal || attempt === 3) throw err;
      console.warn(
        `[video-gen] segment ${segmentId}: poll attempt ${attempt} failed (${msg}), retrying...`,
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!result) throw new Error(`segment ${segmentId} poll returned no result`);

  // Download
  const clipPath = path.join(clipsDir, `segment-${segmentId}.mp4`);
  await downloadFile(result.url, clipPath);
  console.log(`[video-gen] segment ${segmentId}: downloaded → ${clipPath}`);

  // Extract last frame
  const lastFramePath = path.join(framesDir, `segment-${segmentId}-last.png`);
  await extractLastFrame(clipPath, lastFramePath);

  // Save clip info
  const actualDuration = await getVideoDuration(clipPath);
  const clipInfo = {
    segmentId,
    filePath: `clips/segment-${segmentId}.mp4`,
    lastFramePath: `frames/segment-${segmentId}-last.png`,
    duration: actualDuration,
    taskId: result.taskId,
  };
  fs.writeFileSync(
    path.join(clipsDir, `segment-${segmentId}-info.json`),
    JSON.stringify(clipInfo, null, 2),
    "utf-8",
  );

  console.log(
    `[video-gen] segment ${segmentId}: done (${actualDuration.toFixed(2)}s)`,
  );
}

// Transitions + Assembly
console.log("\n[transitions] starting...");
const state = ProjectState.load(projectDir);
await runTransitionsStage(projectDir, state);
console.log("[transitions] completed");

const freshState = ProjectState.load(projectDir);
console.log("[assembly] starting...");
await runAssemblyStage(projectDir, freshState);
console.log(`[assembly] done: ${path.join(projectDir, "output/final.mp4")}`);
