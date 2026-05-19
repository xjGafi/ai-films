import type { VideoPromptConfig } from "../types.js";

/**
 * 构建 Seedance 2.0 视频生成提示词。
 * 对齐官方提示词指南的中文分镜格式。
 */
export function buildSeedancePrompt(config: VideoPromptConfig): string {
  const parts: string[] = [];

  if (config.materialDesc) {
    parts.push(config.materialDesc);
  }

  if (config.continuityNote) {
    parts.push(config.continuityNote);
  }

  if (config.shotSequence) {
    parts.push(config.shotSequence);
  }

  if (config.constraints) {
    parts.push(config.constraints);
  }

  return parts.join("\n\n");
}
