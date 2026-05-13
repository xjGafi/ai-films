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

async function getVideoStreamDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=duration",
    "-of",
    "csv=p=0",
    videoPath,
  ]);
  const parsed = parseFloat(stdout.trim());
  if (Number.isNaN(parsed)) {
    throw new Error(`Could not read video stream duration for ${videoPath}`);
  }
  return parsed;
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

  // Probe actual video stream durations — container duration can exceed
  // stream duration, causing xfade offsets to overshoot and silently fail.
  const streamDurations = await Promise.all(
    clips.map((c) => getVideoStreamDuration(c.path)),
  );

  const inputs: string[] = [];
  for (const clip of clips) {
    inputs.push("-i", clip.path);
  }

  const filterParts: string[] = [];
  let offset = streamDurations[0];

  for (let i = 1; i < clips.length; i++) {
    const transition = clips[i].transition;
    const prevLabel =
      i === 1 ? "[0:v][1:v]" : "[v" + (i - 2) + (i - 1) + "][" + i + ":v]";
    const nextLabel =
      i === clips.length - 1 ? "[vout]" : "[v" + (i - 1) + i + "]";

    const dur =
      transition?.strategy === "continuity_crossfade" &&
      transition.crossfadeDuration
        ? transition.crossfadeDuration
        : 0.1;

    filterParts.push(
      prevLabel +
        "xfade=transition=fade:duration=" +
        dur +
        ":offset=" +
        (offset - dur).toFixed(2) +
        nextLabel,
    );
    offset += streamDurations[i] - dur;
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
