# Fix: Screenplay Generation Quality

**Date**: 2026-05-15  
**Files**: `src/prompts/screenplay.ts`, `src/pipeline/stages/3-prompts.ts`

---

## 问题一：角色/场景 ID 格式改为语义化

### 根因

`SYSTEM_PROMPT` schema 示例和 KEY REQUIREMENTS 9/10 里都用单字母（A, B, C）作为 ID，导致 shot 的 `scene` 字段和 character 的 `(id)` 标注全是字母，读起来容易混淆角色和场景。

### 修复范围

仅改 `src/prompts/screenplay.ts`，不涉及其他文件（types.ts 的 id 字段已是 string，无需改）。

**改动 1 — schema 示例**（SYSTEM_PROMPT 顶部的 JSON schema 块）

```
// characters.id 示例:
"id": "character-1"   // was: "A"

// scenes.id 示例:
"id": "scene-1"       // was: "A"

// shots.scene 示例:
"scene": "scene-1"    // was: "A"
```

**改动 2 — KEY REQUIREMENT 9**

```
// Before:
"9. SCENE IDENTIFIERS: Use letter ids (A, B, C…) as scene identifiers..."

// After:
"9. SCENE IDENTIFIERS: Use semantic ids in the format 'scene-1', 'scene-2', 'scene-3'...
   For characters use 'character-1', 'character-2', 'character-3'...
   These ids are used by the pipeline — do not use single letters."
```

**改动 3 — KEY REQUIREMENT 10**

```
// Before:
"The 'id' must be a letter (A, B, …)..."

// After:
"The 'id' must use the format 'scene-1', 'scene-2'... matching the FIXED SCENES ids if provided."
```

**改动 4 — user prompt 末尾的提醒**

```
// Before:
"id must be a letter (A, B, …) matching shot scene values"

// After:
"id must use format 'scene-1', 'scene-2'... matching shot scene values"
```

**改动 5 — ACTION DESCRIPTIONS 里的角色标注说明**（KEY REQUIREMENT 6 或新增说明）

当前 action 文本用 `(A)`, `(B)` 标注角色，改为 `(character-1)`, `(character-2)`：

在 KEY REQUIREMENT 6 末尾追加：
```
- When a character first appears in a shot, append their id in parentheses after their name:
  e.g. "老王 (character-1) sits on the bench" or "insulin搬运工小人 (character-2) lift the key"
```

---

## 问题二：剧本生成质量——三类系统性缺陷

### 缺陷 A — 群体角色 detail 写成个体形态

当一个角色是多个相同小人的群体（如胰岛素搬运工小人），LLM 默认写单数视觉描述，导致生成图片/视频时模型只生成一个，而不是一群。

**修复**：在 KEY REQUIREMENT 5（CHARACTER DESCRIPTIONS）末尾追加：

```
- GROUP CHARACTERS: If a character represents a group of identical figures (e.g. "workers",
  "guards", "clones"), the "detail" field MUST start with "A group of identical [N]..."
  and describe their shared appearance as a collective unit, not a single individual.
  Example: "A group of identical 10cm tall tiny humanoid figures, each with..."
```

### 缺陷 B — 角色以非正常尺寸出场时缺少尺寸锚定

当剧情需要角色变小（站在肩膀上、进入人体内）时，LLM 生成的 shot action 只写"tiny"或"miniaturized"，没有给出具体尺寸参照，视频模型无法正确渲染比例。

**修复**：在 KEY REQUIREMENT 6（ACTION DESCRIPTIONS）末尾追加：

```
- SCALE CHANGES: If a character appears at a non-standard size (miniaturized, enlarged),
  the action description MUST include a concrete size reference anchored to a visible object
  in the same frame. Example: "a miniaturized 8cm-tall version of [character], no taller
  than the shirt collar beside them". Never use just "tiny" or "small" without a reference.
```

### 缺陷 C — 跨场景幕切缺少叙事/心理过渡

当相邻两幕发生场景切换（尤其是 体内世界→现实世界 这类强对比切），LLM 常直接在新幕第一个 shot 展示新场景，没有提供衔接动机，观众会感到突兀。

**修复**：在 KEY REQUIREMENT 3（TRANSITION HINTS）里扩充 `occlusion_transition` 和 `hard_cut` 的说明，并在末尾追加：

```
- SCENE TRANSITION RULE: When consecutive acts take place in different scenes, the FIRST
  shot of the new act must contain a bridging element — either a psychological reaction
  (a character's face reflecting what they just experienced), a visual echo (a ghost image
  of the previous scene), or an environmental cue that motivates the location change.
  Never open a new scene without a narrative reason visible in frame.
- occlusion_transition: use ONLY when a physical object (door, wall, crowd) can plausibly
  occlude the cut. Do NOT use for abstract location jumps (inside body → outdoors).
  For those, use hard_cut instead.
```

---

## 问题二（代码侧）：`determineTransitionStrategy` 不校验 occlusion 可行性

### 根因

`3-prompts.ts:determineTransitionStrategy` 直接采纳 `transitionHints` 里的策略，不验证 `occlusion_transition` 在当前场景切换下是否物理可行。体内农场→社区公园这类场景之间没有共同空间，遮挡物不存在，`occlusion_transition` 是错误策略。

### 修复

在 `determineTransitionStrategy` 函数里，当 hint 是 `occlusion_transition` 且前后场景不同时，校验是否合理：

```typescript
// 当前逻辑取 hint 后，追加一个 guard：
if (hint === "occlusion_transition") {
  const sameScene =
    prevLastShot?.scene &&
    firstShot?.scene &&
    prevLastShot.scene === firstShot.scene;
  // 同场景内才能用遮挡过渡；跨场景降级为 hard_cut
  if (!sameScene) return "hard_cut";
}
return hint;
```

---

## 实施顺序

1. `src/prompts/screenplay.ts` — ID 格式（改动 1-5）
2. `src/prompts/screenplay.ts` — 三条 KEY REQUIREMENTS 追加
3. `src/pipeline/stages/3-prompts.ts` — `determineTransitionStrategy` guard

完成后运行 `pnpm run typecheck`，再跑一次完整 Stage 0 验证 LLM 输出格式。
