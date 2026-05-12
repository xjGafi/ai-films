/**
 * Integration test — requires VOLC_API_KEY.
 * Tests actual API calls: chat, image gen, video submit.
 *
 * Run:  VOLC_API_KEY=xxx npx tsx src/tests/integration.ts
 *
 * Options:
 *   --stage <0|1|2|4>   only run a specific stage test (default: all)
 *   --quick              use shorter prompts and skip video polling
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectState } from "../pipeline/state.js";
import { createProject } from "../project.js";
import { buildCharacterSheetPrompt } from "../prompts/character-sheet.js";
import { buildScreenplayPrompt } from "../prompts/screenplay.js";
import {
  extractFirstFrame,
  extractLastFrame,
  getVideoDuration,
} from "../providers/ffmpeg.js";
import {
  chat,
  generateImage,
  imagePathToDataUri,
  saveBuffer,
  submitVideoTask,
} from "../providers/volcengine.js";
import type { CharacterSpec, ProjectConfig } from "../types.js";

const apiKey = process.env.VOLC_API_KEY;
if (!apiKey) {
  console.error("VOLC_API_KEY is required. Set it and re-run.");
  process.exit(1);
}

const args = process.argv.slice(2);
const stageFilter = args.includes("--stage")
  ? args[args.indexOf("--stage") + 1]
  : "all";
const quick = args.includes("--quick");

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(
      `  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-films-integ-"));

async function main() {
  // ─── Stage 0: Chat (LLM) ───
  if (stageFilter === "all" || stageFilter === "0") {
    console.log("\n=== Stage 0: LLM Chat ===");
    await test("chat returns non-empty string", async () => {
      const result = await chat(
        [{ role: "user", content: "Say 'hello' in one word." }],
        { maxTokens: 10 },
      );
      if (!result || result.trim().length === 0)
        throw new Error("Empty response");
    });

    if (!quick) {
      await test("chat returns valid JSON with json_object mode", async () => {
        const result = await chat(
          [
            {
              role: "system",
              content: "Output a JSON object with a 'greeting' key.",
            },
            { role: "user", content: "Say hello" },
          ],
          { responseFormat: { type: "json_object" } },
        );
        const parsed = JSON.parse(result);
        if (!parsed.greeting)
          throw new Error("Missing 'greeting' key in response");
      });

      await test("screenplay prompt produces valid structure", async () => {
        const msgs = buildScreenplayPrompt(
          "A robot discovers emotions",
          [{ name: "Robo" }],
          30,
          "cinematic",
        );
        const result = await chat(msgs, {
          responseFormat: { type: "json_object" },
          maxTokens: 4096,
        });
        const parsed = JSON.parse(result);
        if (!parsed.title) throw new Error("Missing title");
        if (!Array.isArray(parsed.acts)) throw new Error("Missing acts array");
        if (!Array.isArray(parsed.characters))
          throw new Error("Missing characters array");
        console.log(
          `    Title: ${parsed.title}, Acts: ${parsed.acts.length}, Shots: ${parsed.acts.reduce((s: number, a: { shots: unknown[] }) => s + a.shots.length, 0)}`,
        );
      });
    }
  }

  // ─── Stage 1: Image generation ───
  if (stageFilter === "all" || stageFilter === "1") {
    console.log("\n=== Stage 1: Image Generation ===");
    await test("generateImage returns a buffer", async () => {
      const buffer = await generateImage(
        "A simple white circle on black background",
        { size: "1920x1920" },
      );
      if (buffer.length < 1000) throw new Error("Image too small");
      const imgPath = path.join(tmpDir, "test-image.png");
      saveBuffer(buffer, imgPath);
      console.log(
        `    Saved: ${imgPath} (${(buffer.length / 1024).toFixed(0)} KB)`,
      );
    });

    await test("generateImage with seed accepts options without error", async () => {
      const buffer = await generateImage(
        "A single white circle on a black background",
        { size: "1920x1920", seed: 42 },
      );
      if (buffer.length < 1000) throw new Error("Image too small");
      console.log(`    Seeded image: ${(buffer.length / 1024).toFixed(0)} KB`);
    });

    if (!quick) {
      await test("character sheet prompt generates reference image", async () => {
        const charSpec: CharacterSpec = {
          id: "A",
          name: "TestChar",
          detailedDescription:
            "A young woman with short red hair, green eyes, wearing a white lab coat",
        };
        const prompt = buildCharacterSheetPrompt(charSpec, "cinematic");
        const buffer = await generateImage(prompt, { size: "1536x1024" });
        const imgPath = path.join(tmpDir, "character-ref.png");
        saveBuffer(buffer, imgPath);
        console.log(
          `    Saved: ${imgPath} (${(buffer.length / 1024).toFixed(0)} KB)`,
        );
      });
    }
  }

  // ─── Stage 2: Video task ───
  if (stageFilter === "all" || stageFilter === "2") {
    console.log("\n=== Stage 2: Video Task ===");
    await test("submitVideoTask returns a task ID", async () => {
      const taskId = await submitVideoTask({
        prompt: "A single red ball bouncing on a white floor, simple physics",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
      });
      if (!taskId || taskId.trim().length === 0)
        throw new Error("Empty task ID");
      console.log(`    Task ID: ${taskId}`);
    });

    await test("submitVideoTask accepts base64 data URI as reference_image", async () => {
      // Use a real generated image so the API receives a valid PNG
      const refBuffer = await generateImage("A white circle on black", {
        size: "1920x1920",
      });
      const tmpRef = path.join(tmpDir, "integ-char-ref.png");
      saveBuffer(refBuffer, tmpRef);

      const dataUri = imagePathToDataUri(tmpRef);
      if (!dataUri.startsWith("data:image/png;base64,"))
        throw new Error("imagePathToDataUri returned unexpected format");
      const taskId = await submitVideoTask({
        prompt: "A single red ball bouncing on a white floor, simple physics",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
        reference_images: [dataUri],
      });
      if (!taskId || taskId.trim().length === 0)
        throw new Error("Empty task ID when using base64 reference_images");
      console.log(`    Task ID (with base64 ref): ${taskId}`);
    });

    if (quick) {
      console.log("    (Skipping video polling in quick mode.)");
    }
  }

  // ─── Stage 4: FFmpeg ───
  if (stageFilter === "all" || stageFilter === "4") {
    console.log("\n=== Stage 4: FFmpeg ===");
    // Only test if there's a video file available
    const testVideo = process.env.TEST_VIDEO_PATH;
    if (testVideo && fs.existsSync(testVideo)) {
      await test("getVideoDuration returns a number", async () => {
        const dur = await getVideoDuration(testVideo);
        if (dur <= 0) throw new Error(`Invalid duration: ${dur}`);
        console.log(`    Duration: ${dur.toFixed(2)}s`);
      });

      await test("extractFirstFrame produces an image", async () => {
        const outPath = path.join(tmpDir, "first-frame.png");
        await extractFirstFrame(testVideo, outPath);
        if (!fs.existsSync(outPath)) throw new Error("Frame not created");
        console.log(`    Saved: ${outPath}`);
      });

      await test("extractLastFrame produces an image", async () => {
        const outPath = path.join(tmpDir, "last-frame.png");
        await extractLastFrame(testVideo, outPath);
        if (!fs.existsSync(outPath)) throw new Error("Frame not created");
        console.log(`    Saved: ${outPath}`);
      });
    } else {
      console.log(
        "    (Set TEST_VIDEO_PATH=/path/to/video.mp4 to test FFmpeg functions)",
      );
    }
  }

  // ─── End-to-end mini pipeline (quick) ───
  if (stageFilter === "all" && quick) {
    console.log("\n=== End-to-End Quick Test ===");
    await test("create project + run screenplay stage", async () => {
      const config: ProjectConfig = {
        story: "A cat watches the sunset",
        duration: 30,
        style: "cinematic",
        seed: 42,
        resolution: "720p",
        aspectRatio: "16:9",
        characters: [{ name: "Mochi" }],
      };
      const projectDir = createProject(tmpDir, config);
      const state = ProjectState.load(projectDir);

      // Stage 0: Screenplay
      const msgs = buildScreenplayPrompt(
        config.story,
        config.characters,
        config.duration,
        config.style,
      );
      const raw = await chat(msgs, {
        responseFormat: { type: "json_object" },
        maxTokens: 4096,
      });
      const screenplay = JSON.parse(raw);
      fs.writeFileSync(
        path.join(projectDir, "screenplay.json"),
        JSON.stringify(screenplay, null, 2),
      );
      state.markCompleted("screenplay", { screenplay: "screenplay.json" });
      state.save();

      console.log(`    Project: ${path.basename(projectDir)}`);
      console.log(
        `    Screenplay: ${screenplay.title}, ${screenplay.acts?.length ?? 0} acts`,
      );
    });
  }

  // ─── Cleanup ───
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
