#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_DURATION,
  DEFAULT_RESOLUTION,
  DEFAULT_SEED,
  DEFAULT_STYLE,
} from "./config.js";
import { parseStory } from "./pipeline/parse.js";
import { runPipeline } from "./pipeline/runner.js";
import {
  cleanIntermediate,
  createProject,
  findProjectDir,
  listProjects,
  loadProject,
} from "./project.js";
import type { CharacterInput, ParsedFilmConfig, StageName } from "./types.js";
import { type ProjectConfig, STAGE_NAMES } from "./types.js";

const BASE_DIR = process.cwd();

const program = new Command();

program
  .name("ai-film")
  .description("AI long video generation pipeline")
  .version("0.1.0");

// ─── create ───

program
  .command("create")
  .description("Create a new AI film project")
  .option("--config <path>", "path to JSON config file")
  .option("-s, --story <text>", "story description")
  .option(
    "-c, --character <name:path>",
    "character name:image path (repeatable)",
    collectRepeatable,
    [] as string[],
  )
  .option(
    "-d, --duration <seconds>",
    "duration in seconds (60|90|120)",
    String(DEFAULT_DURATION),
  )
  .option(
    "--style <style>",
    "video style (cinematic|anime|3d-pixar)",
    DEFAULT_STYLE,
  )
  .option("--resolution <res>", "resolution (720p|1080p)", DEFAULT_RESOLUTION)
  .option("--seed <number>", "random seed", String(DEFAULT_SEED))
  .action((opts) => {
    // Load config file if provided
    let fileConfig: Partial<ProjectConfig> & { characters?: CharacterInput[] } =
      {};
    if (opts.config) {
      const configPath = path.resolve(opts.config);
      if (!fs.existsSync(configPath)) {
        console.error(`Config file not found: ${configPath}`);
        process.exit(1);
      }
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }

    // Parse CLI characters
    const cliCharacters: CharacterInput[] = opts.character.map(
      (entry: string) => {
        const colonIndex = entry.indexOf(":");
        if (colonIndex === -1) {
          return { name: entry };
        }
        const name = entry.slice(0, colonIndex);
        const imagePath = entry.slice(colonIndex + 1);
        return { name, imagePath };
      },
    );

    // Merge: config file as base, CLI flags override
    const story = opts.story ?? fileConfig.story;
    if (!story) {
      console.error("Story is required (via --story or config file)");
      process.exit(1);
    }

    const fileCharacters = fileConfig.characters ?? [];
    const characters = [...fileCharacters, ...cliCharacters];

    const config: ProjectConfig = {
      story,
      duration:
        parseInt(opts.duration, 10) ?? fileConfig.duration ?? DEFAULT_DURATION,
      style:
        opts.style !== DEFAULT_STYLE
          ? opts.style
          : (fileConfig.style ?? DEFAULT_STYLE),
      seed: parseInt(opts.seed, 10) ?? fileConfig.seed ?? DEFAULT_SEED,
      resolution:
        opts.resolution !== DEFAULT_RESOLUTION
          ? opts.resolution
          : (fileConfig.resolution ?? DEFAULT_RESOLUTION),
      aspectRatio: fileConfig.aspectRatio ?? DEFAULT_ASPECT_RATIO,
      characters,
    };

    const projectDir = createProject(BASE_DIR, config);
    const projectId = path.basename(projectDir);

    console.log(`Project created!`);
    console.log(`  ID:   ${projectId}`);
    console.log(`  Dir:  ${projectDir}`);
  });

// ─── run ───

program
  .command("run <projectId>")
  .description("Run the AI film pipeline for a project")
  .option("--from <stage>", "resume from a specific stage")
  .option("--to <stage>", "stop after completing this stage")
  .option("--clean", "clear intermediate files before running")
  .action(async (projectId: string, opts) => {
    const projectDir = findProjectDir(BASE_DIR, projectId);
    if (!projectDir) {
      console.error(`Project not found: ${projectId}`);
      process.exit(1);
    }

    if (opts.clean) {
      cleanIntermediate(projectDir);
      console.log("Intermediate files cleared.");
    }

    const fromStage: StageName | undefined = opts.from as StageName | undefined;
    if (fromStage && !STAGE_NAMES.includes(fromStage)) {
      console.error(
        `Invalid stage: ${fromStage}. Valid stages: ${STAGE_NAMES.join(", ")}`,
      );
      process.exit(1);
    }

    const toStage: StageName | undefined = opts.to as StageName | undefined;
    if (toStage && !STAGE_NAMES.includes(toStage)) {
      console.error(
        `Invalid stage: ${toStage}. Valid stages: ${STAGE_NAMES.join(", ")}`,
      );
      process.exit(1);
    }

    try {
      await runPipeline(projectDir, { fromStage, toStage });
      console.log("Pipeline completed successfully.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Pipeline failed: ${message}`);
      process.exit(1);
    }
  });

// ─── status ───

program
  .command("status <projectId>")
  .description("Show project status")
  .action((projectId: string) => {
    const projectDir = findProjectDir(BASE_DIR, projectId);
    if (!projectDir) {
      console.error(`Project not found: ${projectId}`);
      process.exit(1);
    }

    const state = loadProject(projectDir);

    console.log(`Project: ${state.projectId}`);
    console.log(`Created: ${state.createdAt}`);
    console.log();

    let completed = 0;
    for (const stageName of STAGE_NAMES) {
      const stage = state.stages[stageName];
      const artifactCount = Object.keys(stage.artifacts).length;
      const statusTag = stage.status.toUpperCase().padEnd(12);
      let line = `  ${stageName.padEnd(14)} ${statusTag} artifacts: ${artifactCount}`;
      if (stage.error) {
        line += `  error: ${stage.error}`;
      }
      console.log(line);
      if (stage.status === "completed") {
        completed++;
      }
    }

    console.log();
    console.log(
      `Progress: ${completed}/${STAGE_NAMES.length} stages completed`,
    );
  });

// ─── regen ───

program
  .command("regen <projectId>")
  .description("Regenerate a specific clip")
  .option("--clip <N>", "clip index to regenerate")
  .action(async (projectId: string, opts) => {
    const projectDir = findProjectDir(BASE_DIR, projectId);
    if (!projectDir) {
      console.error(`Project not found: ${projectId}`);
      process.exit(1);
    }

    const clipIndex = opts.clip ? parseInt(opts.clip, 10) : undefined;
    if (clipIndex === undefined) {
      console.error("--clip <N> is required");
      process.exit(1);
    }

    // Delete specific clip file and its frame
    const clipFile = path.join(projectDir, "clips", `segment-${clipIndex}.mp4`);
    const frameFile = path.join(
      projectDir,
      "frames",
      `segment-${clipIndex}-last.png`,
    );

    if (fs.existsSync(clipFile)) {
      fs.rmSync(clipFile);
      console.log(`Deleted clip: ${clipFile}`);
    }
    if (fs.existsSync(frameFile)) {
      fs.rmSync(frameFile);
      console.log(`Deleted frame: ${frameFile}`);
    }

    // TODO: clipIndex option is not fully supported yet
    console.log(
      `TODO: clipIndex=${clipIndex} is not yet supported in runPipeline`,
    );

    try {
      await runPipeline(projectDir, { fromStage: "video-gen" });
      console.log("Regeneration completed.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Regeneration failed: ${message}`);
      process.exit(1);
    }
  });

// ─── list ───

program
  .command("list")
  .description("List all projects")
  .action(() => {
    const projects = listProjects(BASE_DIR);

    if (projects.length === 0) {
      console.log("No projects found.");
      return;
    }

    // Table header
    const idHeader = "ID";
    const createdHeader = "CREATED";
    const statusHeader = "STATUS";

    console.log(
      `${idHeader.padEnd(38)} ${createdHeader.padEnd(26)} ${statusHeader}`,
    );
    console.log("-".repeat(80));

    for (const p of projects) {
      const state = loadProject(p.dir);
      const completed = STAGE_NAMES.filter(
        (s) => state.stages[s].status === "completed",
      ).length;
      const statusStr = `${completed}/${STAGE_NAMES.length} completed`;
      const idShort = p.id;
      const createdShort = p.createdAt.slice(0, 19).replace("T", " ");

      console.log(
        `${idShort.padEnd(38)} ${createdShort.padEnd(26)} ${statusStr}`,
      );
    }
  });

// ─── clean ───

program
  .command("clean <projectId>")
  .description(
    "Clean intermediate files and reset stages from video-gen onward",
  )
  .action((projectId: string) => {
    const projectDir = findProjectDir(BASE_DIR, projectId);
    if (!projectDir) {
      console.error(`Project not found: ${projectId}`);
      process.exit(1);
    }

    // Remove intermediate directories
    cleanIntermediate(projectDir);

    // Reset stages from video-gen onward
    const state = loadProject(projectDir);
    state.resetFrom("video-gen");
    state.save();

    console.log(`Cleaned intermediate files for project ${projectId}`);
    console.log("Stages from video-gen onward have been reset to pending.");
  });

// ─── parse ───

program
  .command("parse <story-file>")
  .description("Parse a story file into a film.json config")
  .option(
    "--output <path>",
    "output path for film.json",
    "./tests/fixtures/film.json",
  )
  .option("--run", "auto-execute create + run after parsing")
  .option("--dry-run", "print result to stdout without writing or running")
  .action(async (storyFile: string, opts) => {
    if (opts.run && opts.dryRun) {
      console.error("--run and --dry-run cannot be used together");
      process.exit(1);
    }

    const storyFilePath = path.resolve(storyFile);
    if (!fs.existsSync(storyFilePath)) {
      console.error(`Story file not found: ${storyFilePath}`);
      process.exit(1);
    }

    const storyText = fs.readFileSync(storyFilePath, "utf-8");

    let parsed: ParsedFilmConfig;
    try {
      parsed = await parseStory(storyText);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to parse story: ${message}`);
      process.exit(1);
    }

    if (opts.dryRun) {
      console.log(JSON.stringify(parsed, null, 2));
      process.exit(0);
    }

    // Convert ParsedFilmConfig → ProjectConfig (drop title, map fields)
    const config: ProjectConfig = {
      story: parsed.story,
      duration: parsed.duration,
      style: parsed.style,
      seed: parsed.seed,
      resolution: parsed.resolution,
      aspectRatio: parsed.aspectRatio,
      characters: parsed.characters.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        detail: c.detail,
      })) satisfies CharacterInput[],
      scenes: parsed.scenes.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        detail: s.detail,
      })),
    };

    const outputPath = path.resolve(opts.output);
    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2), "utf-8");
    console.log(`Config written to ${outputPath}`);

    if (opts.run) {
      const projectDir = createProject(BASE_DIR, config);
      const projectId = path.basename(projectDir);
      console.log(`Project created: ${projectId}`);
      try {
        await runPipeline(projectDir, {});
        console.log("Pipeline completed successfully.");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Pipeline failed: ${message}`);
        process.exit(1);
      }
    }
  });

// ─── Helpers ───

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

// ─── Main ───

program.parse();
