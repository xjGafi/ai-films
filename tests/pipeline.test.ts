import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseStory } from "../src/pipeline/parse.js";
import { runPipeline } from "../src/pipeline/runner.js";
import { ProjectState } from "../src/pipeline/state.js";
import { createProject } from "../src/project.js";
import type { CharacterInput, ProjectConfig } from "../src/types.js";

dotenv.config();

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");

function loadJsonConfig(filename: string): ProjectConfig {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, filename), "utf-8"),
  );
  return {
    story: raw.story,
    duration: raw.duration,
    style: raw.style,
    seed: raw.seed,
    resolution: raw.resolution ?? "720p",
    aspectRatio: raw.aspectRatio ?? "16:9",
    characters: raw.characters as CharacterInput[],
    scenes: raw.scenes,
  };
}

describe("Pipeline", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-films-pipeline-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("从 JSON 配置跑全流程", async () => {
    const config = loadJsonConfig("film.json");
    const projectDir = createProject(tmpDir, config);

    await runPipeline(projectDir);

    const state = ProjectState.load(projectDir);
    expect(state.isCompleted("screenplay")).toBe(true);
    expect(state.isCompleted("characters")).toBe(true);
    expect(state.isCompleted("storyboard")).toBe(true);
    expect(state.isCompleted("prompts")).toBe(true);
    expect(state.isCompleted("video-gen")).toBe(true);
    expect(state.isCompleted("transitions")).toBe(true);
    expect(state.isCompleted("assembly")).toBe(true);

    expect(fs.existsSync(path.join(projectDir, "screenplay.json"))).toBe(true);
    expect(
      fs.readdirSync(path.join(projectDir, "characters")).length,
    ).toBeGreaterThan(0);
    expect(
      fs.readdirSync(path.join(projectDir, "clips")).length,
    ).toBeGreaterThan(0);
  });

  it("从 TXT 故事文本跑全流程", async () => {
    const storyText = fs.readFileSync(
      path.join(FIXTURES, "story.txt"),
      "utf-8",
    );
    const parsed = await parseStory(storyText);

    const config: ProjectConfig = {
      story: parsed.story,
      duration: parsed.duration,
      style: parsed.style,
      seed: parsed.seed,
      resolution: parsed.resolution,
      aspectRatio: parsed.aspectRatio,
      characters: parsed.characters as CharacterInput[],
      scenes: parsed.scenes,
    };

    const projectDir = createProject(tmpDir, config);
    await runPipeline(projectDir);

    const state = ProjectState.load(projectDir);
    expect(state.isCompleted("screenplay")).toBe(true);
    expect(state.isCompleted("assembly")).toBe(true);
  });

  it("从指定 stage 恢复执行", async () => {
    const config = loadJsonConfig("film.json");
    const projectDir = createProject(tmpDir, config);

    await runPipeline(projectDir);
    const stateBefore = ProjectState.load(projectDir);
    expect(stateBefore.isCompleted("prompts")).toBe(true);

    await runPipeline(projectDir, { fromStage: "prompts" });

    const stateAfter = ProjectState.load(projectDir);
    expect(stateAfter.isCompleted("prompts")).toBe(true);
    expect(stateAfter.isCompleted("video-gen")).toBe(true);
    expect(stateAfter.isCompleted("assembly")).toBe(true);
  });

  it("重试失败的 stage", async () => {
    const config = loadJsonConfig("film.json");
    const projectDir = createProject(tmpDir, config);

    // 先跑完 screenplay
    await runPipeline(projectDir);

    // 模拟 characters 失败
    const state = ProjectState.load(projectDir);
    state.resetFrom("characters");
    state.recordError("characters", "simulated failure");
    state.save();

    expect(state.stages.characters.status).toBe("failed");

    // 从 characters 重跑
    await runPipeline(projectDir, { fromStage: "characters" });

    const recovered = ProjectState.load(projectDir);
    expect(recovered.isCompleted("characters")).toBe(true);
    expect(recovered.isCompleted("assembly")).toBe(true);
  });
});
