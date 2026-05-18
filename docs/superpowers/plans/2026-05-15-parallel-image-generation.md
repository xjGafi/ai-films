# 角色/场景图片并行生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Stage 1 (characters) 中角色图和场景图的串行生成改为 p-limit 控制的并发执行，提升整体生成速度。

**Architecture:** 安装 `p-limit` 依赖，在 `1-characters.ts` 中将两个 `for...of` + `await` 循环改为收集 Promise 后用 `Promise.all` 并发执行，通过 `p-limit(3)` 限制最大并发数为 3。角色图和场景图之间无依赖，统一进入同一个并发池。

**Tech Stack:** p-limit ^7.x (ESM-only，与项目 ESM 配置兼容)

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `src/pipeline/stages/1-characters.ts` | 引入 p-limit，重构生成逻辑为并发 |
| Modify | `package.json` | 添加 p-limit 依赖 |

共 2 个文件，改动范围小。

---

### Task 1: 安装 p-limit 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 p-limit**

```bash
pnpm add p-limit
```

- [ ] **Step 2: 验证安装成功且类型可用**

```bash
pnpm run typecheck
```

Expected: 无新增错误（p-limit 7.x 自带类型声明）

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: 添加 p-limit 用于图片生成并发控制"
```

---

### Task 2: 重构 1-characters.ts 为并发执行

**Files:**
- Modify: `src/pipeline/stages/1-characters.ts:1-90`

- [ ] **Step 1: 重构为并发实现**

将 `1-characters.ts` 完整替换为以下内容：

```typescript
import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { buildCharacterSheetPrompt } from "../../prompts/character-sheet.js";
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

  // 角色图任务
  for (const char of screenplay.characters) {
    const refFileName = `${char.name}-ref.png`;
    const outPath = path.join(charsDir, refFileName);
    const artifactKey = `characters/${refFileName}`;

    const providedImagePath = configCharMap.get(char.name);

    if (providedImagePath && fs.existsSync(providedImagePath)) {
      fs.copyFileSync(providedImagePath, outPath);
      artifacts[artifactKey] = `characters/${refFileName}`;
    } else {
      tasks.push(
        limit(async () => {
          const prompt = buildCharacterSheetPrompt(char, state.config.style);
          const buffer = await generateImage(prompt, {
            seed: state.config.seed,
          });
          saveBuffer(buffer, outPath);
          artifacts[artifactKey] = `characters/${refFileName}`;
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
```

核心变更点：
1. **import pLimit**，定义 `CONCURRENCY = 3` 常量
2. **目录创建提前**到循环外，避免并发 `mkdirSync` 竞争
3. **本地文件复制同步执行**，不进入并发池（无需等待）
4. **API 生成任务收集到 `tasks` 数组**，角色图和场景图统一混入
5. **`await Promise.all(tasks)`** 一次性并发，p-limit 控制最多 3 个同时进行

- [ ] **Step 2: 类型检查**

```bash
pnpm run typecheck
```

Expected: PASS，无错误

- [ ] **Step 3: Lint 检查**

```bash
pnpm run lint
```

Expected: PASS 或仅 formatting 警告（用 `pnpm run format` 修复）

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/stages/1-characters.ts
git commit -m "feat: 角色/场景图片生成改为 p-limit 并发执行（最大并发3）"
```

---

## 验证方式

- `pnpm run typecheck` — 类型正确
- `pnpm run lint` — 代码风格通过
- 实际运行 `pnpm run dev` 生成项目 — 角色和场景图正常生成，观察日志中请求是否并发发出

## 风险

- **API 限流**：如果 Volcengine 对并发有隐式限制，生成可能报错。应对：将 `CONCURRENCY` 从 3 降到 2，或加重试逻辑（不在本次范围内）。

## 不做的事

- 不加重试机制（当前串行版也没有）
- 不改 `generateImage` 函数本身
- 不改 `StageResult` 返回格式
- 不加测试（用户未要求）
