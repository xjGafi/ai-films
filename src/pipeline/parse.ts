import { buildParseStoryPrompt } from "../prompts/parse-story.js";
import { chat } from "../providers/volcengine.js";
import type { ParsedFilmConfig } from "../types.js";

const VALID_STYLES = ["cinematic", "anime", "3d-pixar"] as const;
const VALID_DURATIONS = [60, 90, 120] as const;
const VALID_RESOLUTIONS = ["720p", "1080p"] as const;

/**
 * Parse a freeform story text into a structured ParsedFilmConfig via LLM.
 *
 * - Calls buildParseStoryPrompt to build the message array
 * - Calls the LLM with JSON output mode
 * - Validates required fields
 * - Clamps duration to 60 if it exceeds 60
 */
export async function parseStory(storyText: string): Promise<ParsedFilmConfig> {
  const messages = buildParseStoryPrompt(storyText);

  const raw = await chat(messages, {
    responseFormat: { type: "json_object" },
    maxTokens: 4096,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse story config JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Validate characters
  if (!Array.isArray(parsed.characters) || parsed.characters.length === 0) {
    throw new Error("Parsed config must contain a non-empty characters array");
  }

  // Validate scenes
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error("Parsed config must contain a non-empty scenes array");
  }

  // Validate duration
  const rawDuration = parsed.duration;
  if (
    typeof rawDuration !== "number" ||
    !VALID_DURATIONS.includes(rawDuration as (typeof VALID_DURATIONS)[number])
  ) {
    throw new Error(
      `Parsed config has invalid duration: "${rawDuration}". Must be one of: ${VALID_DURATIONS.join(", ")}`,
    );
  }

  // Validate style
  const rawStyle = parsed.style;
  if (
    typeof rawStyle !== "string" ||
    !VALID_STYLES.includes(rawStyle as (typeof VALID_STYLES)[number])
  ) {
    throw new Error(
      `Parsed config has invalid style: "${rawStyle}". Must be one of: ${VALID_STYLES.join(", ")}`,
    );
  }

  // Validate resolution
  const rawResolution = parsed.resolution;
  if (
    typeof rawResolution !== "string" ||
    !VALID_RESOLUTIONS.includes(
      rawResolution as (typeof VALID_RESOLUTIONS)[number],
    )
  ) {
    throw new Error(
      `Parsed config has invalid resolution: "${rawResolution}". Must be one of: ${VALID_RESOLUTIONS.join(", ")}`,
    );
  }

  // Validate required string fields
  if (typeof parsed.title !== "string" || !parsed.title) {
    throw new Error("Parsed config is missing required field: title");
  }
  if (typeof parsed.story !== "string" || !parsed.story) {
    throw new Error("Parsed config is missing required field: story");
  }
  if (parsed.aspectRatio !== "16:9") {
    throw new Error(
      `Parsed config has invalid aspectRatio: "${parsed.aspectRatio}". Must be "16:9"`,
    );
  }
  if (typeof parsed.seed !== "number") {
    throw new Error("Parsed config is missing required field: seed (number)");
  }

  // Clamp duration: if > 60, force to 60
  const duration: 60 | 90 | 120 =
    rawDuration > 60 ? 60 : (rawDuration as 60 | 90 | 120);

  return {
    title: parsed.title,
    story: parsed.story,
    characters: parsed.characters as { name: string; description: string }[],
    scenes: parsed.scenes as { id: string; description: string }[],
    duration,
    style: rawStyle as "cinematic" | "anime" | "3d-pixar",
    resolution: rawResolution as "720p" | "1080p",
    aspectRatio: "16:9",
    seed: parsed.seed as number,
  };
}
