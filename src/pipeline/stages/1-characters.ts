import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { buildCharacterRefPrompt } from "../../prompts/character-sheet.js";
import { buildSceneRefPrompt } from "../../prompts/scene-ref.js";
import { generateImage, saveBuffer } from "../../providers/volcengine.js";
import type { Screenplay, StageResult, VideoStyle } from "../../types.js";
import type { ProjectState } from "../state.js";

const CONCURRENCY = 3;

export async function runCharactersStage(
  projectDir: string,
  state: ProjectState,
): Promise<StageResult> {
  const screenplayPath = path.join(projectDir, "screenplay.json");
  const raw = fs.readFileSync(screenplayPath, "utf-8");
  const screenplay: Screenplay = JSON.parse(raw);

  const artifacts: Record<string, string> = {};
  const limit = pLimit(CONCURRENCY);

  const configCharMap = new Map(
    state.config.characters.map((c) => [c.name, c.imagePath]),
  );

  const configSceneMap = new Map<string, string | undefined>(
    (state.config.scenes ?? []).map((s) => [s.id, s.imagePath]),
  );

  // 提前创建输出目录，避免并发时竞争
  const charsDir = path.join(projectDir, "characters");
  const scenesDir = path.join(projectDir, "scenes");
  if (!fs.existsSync(charsDir)) fs.mkdirSync(charsDir, { recursive: true });
  if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });

  const tasks: Promise<void>[] = [];

  // 角色图任务：每个角色生成正面和 3/4 两张参考图
  for (const char of screenplay.characters) {
    const providedImagePath = configCharMap.get(char.name);

    if (providedImagePath && fs.existsSync(providedImagePath)) {
      const refFileName = `${char.name}-ref-front.png`;
      const refPath = path.join(charsDir, refFileName);
      fs.copyFileSync(providedImagePath, refPath);
      artifacts[`characters/${refFileName}`] = `characters/${refFileName}`;
    } else {
      const refFileName = `${char.name}-ref-front.png`;
      const refPath = path.join(charsDir, refFileName);
      tasks.push(
        limit(async () => {
          const prompt = buildCharacterRefPrompt(
            char,
            state.config.style,
            "front",
          );
          const buffer = await generateImage(prompt, {
            seed: state.config.seed,
          });
          saveBuffer(buffer, refPath);
          artifacts[`characters/${refFileName}`] = `characters/${refFileName}`;
        }),
      );
    }
  }

  // 场景图任务
  for (const scene of screenplay.scenes) {
    const refFileName = `${scene.id}-ref.png`;
    const outPath = path.join(scenesDir, refFileName);
    const artifactKey = `scenes/${refFileName}`;

    const providedImagePath = configSceneMap.get(scene.id);

    if (providedImagePath && fs.existsSync(providedImagePath)) {
      fs.copyFileSync(providedImagePath, outPath);
      artifacts[artifactKey] = `scenes/${refFileName}`;
    } else {
      tasks.push(
        limit(async () => {
          const prompt = buildSceneRefPrompt(
            scene,
            state.config.style as VideoStyle,
          );
          const buffer = await generateImage(prompt, {
            seed: state.config.seed,
          });
          saveBuffer(buffer, outPath);
          artifacts[artifactKey] = `scenes/${refFileName}`;
        }),
      );
    }
  }

  await Promise.all(tasks);

  return { artifacts };
}
