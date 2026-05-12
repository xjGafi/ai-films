import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import {
  IMAGE_MODEL,
  TEXT_MODEL,
  VIDEO_MAX_POLL_MS,
  VIDEO_MODEL,
  VIDEO_POLL_INTERVAL_MS,
  VOLC_BASE_URL,
} from "../config.js";

// ─── Client setup ───

function getClient(): OpenAI {
  const apiKey = process.env.VOLC_API_KEY;
  if (!apiKey) throw new Error("VOLC_API_KEY environment variable is required");
  return new OpenAI({ apiKey, baseURL: VOLC_BASE_URL });
}

// ─── Text generation ───

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
}

export async function chat(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  options?: ChatOptions,
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: TEXT_MODEL,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    response_format: options?.responseFormat,
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from text API");
  return content;
}

// ─── Image generation ───

export interface ImageOptions {
  size?: string; // "1920x1920" | "1536x1024" | "1024x1536" (min 3,686,400 pixels)
  quality?: string; // "standard" | "hd"
  seed?: number; // for reproducibility — same seed + same prompt = same image
}

export async function generateImage(
  prompt: string,
  options?: ImageOptions,
): Promise<Buffer> {
  const client = getClient();
  const response = await client.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: (options?.size ??
      "1920x1920") as OpenAI.Images.ImageGenerateParams["size"],
    n: 1,
    response_format: "b64_json",
    ...(options?.seed !== undefined && { seed: options.seed }),
  } as Parameters<typeof client.images.generate>[0]);

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in response");
  return Buffer.from(b64, "base64");
}

// ─── Video generation (async task) ───

export interface VideoTaskParams {
  prompt: string;
  image?: string; // URL for first frame (mode A)
  last_frame_image?: string; // URL for last frame (mode A)
  reference_images?: string[]; // URLs for character refs (mode B)
  duration?: number; // seconds, -1 (auto) or 5/10/15
  resolution?: string; // "720p" | "1080p"
  aspect_ratio?: string; // "16:9"
  seed?: number;
}

export interface VideoResult {
  url: string;
  duration: number;
  taskId: string;
}

function getApiKey(): string {
  const key = process.env.VOLC_API_KEY;
  if (!key) throw new Error("VOLC_API_KEY environment variable is required");
  return key;
}

export async function submitVideoTask(
  params: VideoTaskParams,
): Promise<string> {
  const apiKey = getApiKey();

  const body: Record<string, unknown> = {
    model: VIDEO_MODEL,
    content: [
      {
        type: "text",
        text: params.prompt,
      },
    ],
  };

  if (params.image) body.image = params.image;
  if (params.last_frame_image) body.last_frame_image = params.last_frame_image;
  if (params.reference_images?.length)
    body.reference_images = params.reference_images;
  if (params.duration) body.duration = params.duration;
  if (params.resolution) body.resolution = params.resolution;
  if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio;
  if (params.seed !== undefined) body.seed = params.seed;

  const response = await fetch(`${VOLC_BASE_URL}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Video task submission failed (${response.status}): ${text}`,
    );
  }

  const data = await response.json();
  const taskId = data.id ?? data.task_id ?? data.data?.id;
  if (!taskId) {
    throw new Error(
      `No task ID in response: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }

  return taskId;
}

export async function pollVideoTask(taskId: string): Promise<VideoResult> {
  const apiKey = getApiKey();
  const pollUrl = `${VOLC_BASE_URL}/contents/generations/tasks/${taskId}`;
  const startTime = Date.now();

  while (Date.now() - startTime < VIDEO_MAX_POLL_MS) {
    const response = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Video task poll failed (${response.status})`);
    }

    const data = await response.json();
    const status = data.status ?? data.data?.status;

    if (
      status === "SUCCESS" ||
      status === "SUCCEEDED" ||
      status === "succeeded" ||
      status === "complete"
    ) {
      // Extract video URL from response — format may vary
      const videoUrl =
        data.content?.video_url ??
        data.data?.content?.video_url ??
        data.output?.video_url ??
        data.data?.video_url;

      if (!videoUrl) {
        throw new Error(
          `Video completed but no URL found: ${JSON.stringify(data).slice(0, 500)}`,
        );
      }

      const duration =
        data.content?.duration ?? data.data?.content?.duration ?? 0;

      return { url: videoUrl, duration, taskId };
    }

    if (status === "FAILED" || status === "failed" || status === "error") {
      const errorMsg =
        data.error_message ?? data.data?.error_message ?? "Unknown error";
      throw new Error(`Video task failed: ${errorMsg}`);
    }

    // Still processing — wait and retry
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
  }

  throw new Error(
    `Video task timed out after ${VIDEO_MAX_POLL_MS / 1000}s (taskId: ${taskId})`,
  );
}

/** Submit + poll in one call */
export async function generateVideo(
  params: VideoTaskParams,
): Promise<VideoResult> {
  const taskId = await submitVideoTask(params);
  return pollVideoTask(taskId);
}

// ─── File download ───

export async function downloadFile(
  url: string,
  savePath: string,
): Promise<string> {
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed (${response.status}): ${url}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(savePath, buffer);
  return savePath;
}

/** Save a Buffer to disk, creating directories as needed */
export function saveBuffer(buffer: Buffer, savePath: string): string {
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(savePath, buffer);
  return savePath;
}

/** Read a local PNG file and return it as a base64 data URI. PNG files only. */
export function imagePathToDataUri(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}
