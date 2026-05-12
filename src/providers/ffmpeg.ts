import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { OUTPUT_FPS } from "../config.js";
import type { AssemblyTransition } from "../types.js";

const execFileAsync = promisify(execFile);

// ─── Frame extraction ───

export async function extractLastFrame(
  videoPath: string,
  outputPath: string,
): Promise<string> {
  ensureDir(outputPath);
  // Seek to 0.1s before end, grab 1 frame
  await execFileAsync("ffmpeg", [
    "-y",
    "-sseof",
    "-0.1",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-update",
    "1",
    outputPath,
  ]);
  if (!fs.existsSync(outputPath)) {
    // Fallback: use OpenCV-style approach via select filter
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "csv=p=0",
      videoPath,
    ]);
    const totalFrames = parseInt(stdout.trim(), 10);
    if (totalFrames > 0) {
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        videoPath,
        "-vf",
        "select='eq(n\\," + (totalFrames - 1) + ")'",
        "-frames:v",
        "1",
        outputPath,
      ]);
    }
  }
  return outputPath;
}

export async function extractFirstFrame(
  videoPath: string,
  outputPath: string,
): Promise<string> {
  ensureDir(outputPath);
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    outputPath,
  ]);
  return outputPath;
}

// ─── Video concatenation ───

export interface ClipSpec {
  path: string;
  duration: number;
  transition?: AssemblyTransition;
}

export async function concatenateClips(
  clips: ClipSpec[],
  outputPath: string,
): Promise<string> {
  ensureDir(outputPath);

  if (clips.length === 1) {
    fs.copyFileSync(clips[0].path, outputPath);
    return outputPath;
  }

  // Build ffmpeg xfade filter chain for crossfade transitions
  const inputs: string[] = [];
  for (const clip of clips) {
    inputs.push("-i", clip.path);
  }

  const filterParts: string[] = [];
  let offset = clips[0].duration;

  for (let i = 1; i < clips.length; i++) {
    const transition = clips[i].transition;
    const prevLabel =
      i === 1 ? "[0:v][1:v]" : "[v" + (i - 2) + (i - 1) + "][" + i + ":v]";
    const nextLabel =
      i === clips.length - 1 ? "[vout]" : "[v" + (i - 1) + i + "]";

    if (
      transition?.strategy === "continuity_crossfade" &&
      transition.crossfadeDuration
    ) {
      const dur = transition.crossfadeDuration;
      filterParts.push(
        prevLabel +
          "xfade=transition=fade:duration=" +
          dur +
          ":offset=" +
          offset.toFixed(2) +
          nextLabel,
      );
      offset += clips[i].duration - dur;
    } else {
      // Hard cut / occlusion — simple concat (no transition filter)
      // Use a minimal crossfade (0.1s) for smoothness
      const dur = 0.1;
      filterParts.push(
        prevLabel +
          "xfade=transition=fade:duration=" +
          dur +
          ":offset=" +
          offset.toFixed(2) +
          nextLabel,
      );
      offset += clips[i].duration - dur;
    }
  }

  const filterComplex = filterParts.join(";");

  const cmd = [
    "-y",
    ...inputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-r",
    String(OUTPUT_FPS),
    outputPath,
  ];

  await execFileAsync("ffmpeg", cmd, { timeout: 120_000 });
  return outputPath;
}

// ─── Resolution normalization ───

export async function normalizeResolution(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  ensureDir(outputPath);
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=" +
      OUTPUT_FPS,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    outputPath,
  ]);
  return outputPath;
}

// ─── Get video duration ───

export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    videoPath,
  ]);
  return parseFloat(stdout.trim());
}

// ─── Helpers ───

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
