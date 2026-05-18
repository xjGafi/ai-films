# Fix: Video Prompt Generation Bugs

**Date**: 2026-05-15  
**Branch**: fix/storyboard-prompt-consistency  
**Files**: `src/pipeline/stages/0-screenplay.ts`, `src/pipeline/stages/3-prompts.ts`, `src/prompts/video-shot.ts`

---

## 背景

排查 segment-1 到 segment-4 的提示词后，发现 prompt 生成器有 7 个系统性 bug，导致：

- 未出场角色污染 reference_images 和 RULES（模型可能把无关角色插入画面）
- `buildRules` 里 [Image1] 指向 prevLastFrame，但 `buildReferenceDescription` 把角色放 Image1，索引不同步
- Row 时间标注（相对时间）与 shot 时间戳（全局时间）坐标系不一致
- UI 文字 shot 与 negatives 里的文字禁令直接冲突（科普文字会被模型忽略）
- 最后一段 endState 错误声称"The next clip will continue"
- `formatTime` 可能输出 `0:60` 格式

---

## Bug 列表与修复

### Bug 1 — referenceImages 顺序与索引不同步（高优先级）

**根因**：`assembleReferenceImages` 把角色放最前，`buildReferenceDescription` 也是角色先（Image1=char1），但 `buildRules` 写死 `[Image1]` 指向 prevLastFrame。三者矛盾。实际生成的 segment JSON 文件显示 prevLastFrame=Image1（旧行为），说明代码修改时引入了不一致。

**修复**：统一将 prevLastFrame 放 Image1（当存在时），角色图随后，场景参考最后。两个函数（`assembleReferenceImages` + `buildReferenceDescription`）保持相同顺序。

```
有 prevLastFrame: [prevLastFrame, ...actingChars, sceneRef]
无 prevLastFrame: [...actingChars, sceneRef]
```

`buildRules` 的 `[Image1]` 引用保持不变，因为 prevLastFrame 始终是 Image1。

---

### Bug 2 — 未出场角色注入（高优先级）

**根因**：`assembleReferenceImages`、`buildReferenceDescription`、`buildRules` 三处均遍历 `screenplay.characters`（全部角色），不管当段 shots 里有没有出场。

**修复**：新增辅助函数 `getActingCharacters`，通过扫描本段所有 shot 的 action + title 文本确定出场角色：

```typescript
function getActingCharacters(
  shots: ShotSpec[],
  characters: CharacterSpec[],
): CharacterSpec[] {
  const allText = shots.map(s => `${s.action} ${s.title ?? ""}`).join(" ");
  const acting = characters.filter(
    char => allText.includes(char.name) || allText.includes(`(${char.id})`),
  );
  // 安全兜底：若一个都匹配不到则回退到全量
  return acting.length > 0 ? acting : characters;
}
```

三处调用点改为使用 `actingCharacters` 替代 `screenplay.characters`：
- `assembleReferenceImages`
- `buildReferenceDescription`
- `buildRules`（charNames 列表）

**前提假设**：LLM 生成的 shot action 包含角色中文名 OR `(${char.id})` 标签。建议在 `src/prompts/screenplay.ts` 的 action 字段说明里加注：角色首次出场时用 `角色名 (ID)` 格式标记。

---

### Bug 3 — Row 时间标注坐标系不一致（中优先级）

**根因**：`video-shot.ts` 里 Row 标注计算相对时间（0–5s / 5–10s / 10–15s），但 shot.time 是全局时间（0:15、0:30…），两者坐标系不同。

**修复**：去掉 Row 标注里的时间范围，仅保留行号：

```typescript
// Before:
parts.push(`[Row ${rowNum} — ${rowStart}–${rowEnd}s]`);
// After:
parts.push(`[Row ${rowNum}]`);
```

---

### Bug 4 — Negatives 禁止 "text overlays" 与 UI 文字 shot 冲突（中优先级）

**根因**：`buildNegatives` 和 `video-shot.ts` 各有一条 "Do not add text overlays"，但：
- segment-3 Shot 2：眼镜扫描数据（`『Blood Glucose: Critical High』`）
- segment-4 Shot 6：健康提示文字（`「管住嘴，迈开腿。」`）

两个 shot 明确要求显示 in-scene UI 文字，negatives 会导致模型忽略这些关键帧内容。

**修复**：两处都改措辞，把禁令限定在"生产水印/字幕"，不覆盖镜头内 UI 元素：

```typescript
// Before:
"add text overlays or watermarks"
// After:
"add production watermarks, subtitles, or captions not described in the shots"
```

`video-shot.ts` 里的硬编码行同步修改：
```typescript
// Before:
"Do not add text overlays, music, or extra characters not described above."
// After:
"Do not add production watermarks or subtitles. Do not add music or extra characters not described above."
```

---

### Bug 5 — Negatives 中 3D 限制与 Pixar style 矛盾（低优先级）

**根因**：`buildNegatives` 硬编码 `"use cartoon or 3D rendering unless specified in style"`，但 `3d-pixar` 项目本身就是 3D，这条逻辑自相矛盾。

**修复**：`buildNegatives` 接收 `style` 参数，按风格区分：

```typescript
function buildNegatives(shots: ..., style: string): string[] {
  const negatives = [
    "add production watermarks, subtitles, or captions not described in the shots",
    "introduce characters not described above",
    "skip or reorder any shot",
    style === "3d-pixar"
      ? "use flat 2D cartoon style"
      : "use cartoon or 3D rendering unless specified in style",
  ];
  ...
}
```

---

### Bug 6 — 最后一段 endState 误声称有下一段（低优先级）

**根因**：`buildEndState` 无论是否最后一段，总是追加 `" The next clip will continue from this state."`

**修复**：传入 `isLastSegment` 标志：

```typescript
function buildEndState(shots: ..., isLastSegment: boolean): string {
  ...
  if (isLastSegment) {
    desc += " This is the final scene. The film ends here.";
  } else {
    desc += " The next clip will continue from this state.";
  }
  return desc;
}
```

调用点：`runPromptsStage` 里传 `segmentId === screenplay.acts.length`。

---

### Bug 7 — `formatTime` 可能输出 `0:60`（低优先级）

**根因**：`0-screenplay.ts` 里 `Math.round(seconds % 60)` 在 `seconds % 60 >= 59.5` 时产生 `60`，格式非法（segment-4 Shot 9 的 `"0:58-0:60"` 即是此 bug 输出）。

**修复**：

```typescript
function formatTime(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

用整数秒计算，避免浮点 `%` 带来的边界问题。

---

## 不在本次范围

- **超短 shot（1秒）**：screenplay LLM 的 pace 分配质量问题，需改 storyboard prompt，单独处理
- **segment-4 跨场景深层衔接**：体内世界→公园的切回需要 screenplay LLM 生成显式过渡 shot，属内容生成质量问题

---

## 实施顺序

1. `src/pipeline/stages/0-screenplay.ts` — Bug 7: `formatTime`
2. `src/pipeline/stages/3-prompts.ts` — Bug 1+2+5+6
3. `src/prompts/video-shot.ts` — Bug 3+4

完成后运行 `pnpm run typecheck` 验证，再用 `pnpm run dev -- --from prompts` 重新生成 4 段 segment JSON，对比 diff 检查修复效果。
