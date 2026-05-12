/**
 * Smoke test — no API key needed.
 * Validates: compilation, project CRUD, state management, prompt builders.
 *
 * Run:  npx tsx src/tests/smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectState } from "../pipeline/state.js";
import {
  cleanIntermediate,
  createProject,
  findProjectDir,
  listProjects,
  loadProject,
} from "../project.js";
import { buildCharacterSheetPrompt } from "../prompts/character-sheet.js";
import { buildScreenplayPrompt } from "../prompts/screenplay.js";
import { buildStoryboardPrompt } from "../prompts/storyboard.js";
import { buildSeedancePrompt } from "../prompts/video-shot.js";
import type {
  CharacterSpec,
  ProjectConfig,
  ShotSpec,
  VideoPromptConfig,
} from "../types.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// ─── 1. State management ───

console.log("\n=== State Management ===");
{
  const config: ProjectConfig = {
    story: "A hero saves the world",
    duration: 60,
    style: "cinematic",
    seed: 42,
    resolution: "720p",
    aspectRatio: "16:9",
    characters: [{ name: "hero", imagePath: "/tmp/hero.png" }],
  };

  const state = new ProjectState("test-id", config);
  assert(state.projectId === "test-id", "projectId set");
  assert(state.config.story === "A hero saves the world", "config set");
  assert(
    state.getResumeStage() === "screenplay",
    "first pending stage is screenplay",
  );
  assert(
    !state.isCompleted("screenplay"),
    "screenplay not completed initially",
  );

  state.markInProgress("screenplay");
  assert(
    state.stages.screenplay.status === "in_progress",
    "screenplay in progress",
  );

  state.markCompleted("screenplay", { screenplay: "screenplay.json" });
  assert(state.isCompleted("screenplay"), "screenplay completed");
  assert(
    state.stages.screenplay.artifacts.screenplay === "screenplay.json",
    "artifact recorded",
  );
  assert(
    state.getResumeStage() === "characters",
    "next pending stage is characters",
  );

  state.recordError("characters", "API timeout");
  assert(state.stages.characters.status === "failed", "characters failed");
  assert(state.stages.characters.attempts === 1, "attempts incremented");
  assert(state.stages.characters.error === "API timeout", "error recorded");

  state.resetFrom("characters");
  assert(
    state.stages.characters.status === "pending",
    "characters reset to pending",
  );
  assert(
    state.stages.screenplay.status === "completed",
    "screenplay still completed",
  );
}

// ─── 2. Project CRUD ───

console.log("\n=== Project CRUD ===");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-films-test-"));
{
  const config: ProjectConfig = {
    story: "Test story",
    duration: 60,
    style: "anime",
    seed: 1,
    resolution: "720p",
    aspectRatio: "16:9",
    characters: [{ name: "Alice" }],
  };

  const projectDir = createProject(tmpDir, config);
  assert(
    fs.existsSync(path.join(projectDir, "state.json")),
    "state.json created",
  );
  assert(
    fs.existsSync(path.join(projectDir, "characters")),
    "characters/ dir created",
  );
  assert(fs.existsSync(path.join(projectDir, "clips")), "clips/ dir created");

  const loaded = loadProject(projectDir);
  assert(loaded.projectId.length > 0, "project has ID");
  assert(loaded.config.story === "Test story", "config loaded correctly");

  const projectId = path.basename(projectDir);
  const found = findProjectDir(tmpDir, projectId);
  assert(found === projectDir, "findProjectDir returns correct path");

  const notFound = findProjectDir(tmpDir, "nonexistent");
  assert(notFound === null, "findProjectDir returns null for missing");

  const projects = listProjects(tmpDir);
  assert(projects.length === 1, "one project listed");
  assert(projects[0].id === projectId, "project ID matches");

  // Clean intermediate
  cleanIntermediate(projectDir);
  assert(
    fs.existsSync(path.join(projectDir, "clips")),
    "clips/ recreated after clean",
  );
  assert(
    fs.readdirSync(path.join(projectDir, "clips")).length === 0,
    "clips/ empty after clean",
  );
}

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

// ─── 3. Prompt builders ───

console.log("\n=== Prompt Builders ===");
{
  // Screenplay
  const msgs = buildScreenplayPrompt(
    "A cat saves the world",
    [{ name: "Whiskers" }],
    60,
    "cinematic",
  );
  assert(msgs.length === 2, "screenplay prompt has 2 messages");
  assert(msgs[0].role === "system", "first message is system");
  assert(
    msgs[1].content.includes("Whiskers"),
    "user message includes character",
  );
  assert(msgs[1].content.includes("60"), "user message includes duration");
  assert(msgs[1].content.includes("9 shots"), "user message specifies 9 shots");
  assert(
    msgs[1].content.includes("4 acts"),
    "user message includes numActs for 60s",
  );
}

{
  // Character sheet
  const charSpec: CharacterSpec = {
    id: "A",
    name: "Hero",
    detailedDescription:
      "A tall woman in her 30s with long silver hair and green eyes, wearing a dark blue cloak",
  };
  const prompt = buildCharacterSheetPrompt(charSpec, "cinematic");
  assert(prompt.includes("Hero"), "character sheet includes name");
  assert(
    prompt.includes("silver hair"),
    "character sheet includes description",
  );
  assert(prompt.includes("cinematic"), "character sheet includes style");
}

{
  // Storyboard
  const shots: ShotSpec[] = [
    {
      id: 1,
      time: "0:00-0:03",
      type: "WS",
      camera: "tracking",
      action: "Wide shot of the desert",
      emotion: "desolate",
      pace: "slow",
      scene: "desert-ext-day",
    },
    {
      id: 2,
      time: "0:03-0:06",
      type: "CU",
      camera: "static",
      action: "Close-up on the hero's face",
      emotion: "determined",
      pace: "medium",
      scene: "desert-ext-day",
    },
  ];
  const chars: CharacterSpec[] = [
    { id: "A", name: "Hero", detailedDescription: "Tall woman, silver hair" },
  ];
  const prompt = buildStoryboardPrompt(shots, chars, "anime", {
    cols: 2,
    rows: 1,
  });
  assert(
    prompt.includes("2-panel") || prompt.includes("2-column"),
    "storyboard mentions grid size",
  );
  assert(prompt.includes("WS"), "storyboard includes shot type");
  assert(prompt.includes("anime"), "storyboard includes style");
}

{
  // Video shot (Seedance prompt) — 9-shot fixture verifies row grouping headers
  const shots9: ShotSpec[] = Array.from({ length: 9 }, (_, i) => ({
    id: i + 1,
    time: `0:${String(Math.round((i * 15) / 9)).padStart(2, "0")}-0:${String(Math.round(((i + 1) * 15) / 9)).padStart(2, "0")}`,
    type: "MS" as const,
    camera: "static",
    action: `Shot ${i + 1} action`,
    pace: "medium" as const,
    scene: "ext-day",
  }));
  const config: VideoPromptConfig = {
    segmentId: 1,
    mode: "modeB",
    transitionStrategy: "continuity_crossfade",
    intent: "Show the hero arriving at the ancient ruins",
    referenceDesc:
      "[Image1] is Row 1 storyboard\n[Image2] is Row 2\n[Image3] is Row 3",
    rules: ["Keep character appearance consistent"],
    shots: shots9,
    style: "cinematic",
    cameraNotes: [],
    soundDesign: "Wind howling",
    negatives: ["add text overlays"],
    endState: "Hero stands before the sealed door",
    totalDuration: 15,
    seed: 42,
  };
  const prompt = buildSeedancePrompt(config);
  assert(prompt.includes("Shot 1"), "prompt includes shot numbering");
  assert(prompt.includes("15s"), "prompt includes total duration");
  assert(prompt.includes("[Row 1 — 0–5s]"), "row 1 header present");
  assert(prompt.includes("[Row 2 — 5–10s]"), "row 2 header present");
  assert(prompt.includes("[Row 3 — 10–15s]"), "row 3 header present");
}

// ─── Summary ───

console.log(`\n${"=".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
