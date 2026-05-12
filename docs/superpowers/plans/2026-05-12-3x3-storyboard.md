# 3×3 Storyboard + Per-Act Single 15s Clip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the pipeline from a 4×3 storyboard (12 shots/act → 3 clips/act) to a 3×3 storyboard (9 shots/act → 1 clip/act of 15s), with temporal row grouping in the Seedance prompt.

**Architecture:** Five files change. Tasks are ordered so that each step compiles and tests pass before the next begins. The two standalone changes (video-shot.ts, screenplay prompt) come first; the large prompts-stage refactor comes last.

**Tech Stack:** TypeScript strict ESM, pnpm, tsx (no build needed for dev), custom smoke.ts test runner

---

## File map

| File | Change |
|------|--------|
| `src/prompts/video-shot.ts` | Add `[Row N — Xs–Ys]` headers in SHOT SEQUENCE |
| `src/prompts/screenplay.ts` | 9 shots/act, numActs = ceil(duration/15), act-boundary transitions |
| `src/pipeline/stages/2-storyboard.ts` | `GRID_COLS = 3` |
| `src/pipeline/stages/0-screenplay.ts` | Validate `shots.length === 9` |
| `src/pipeline/stages/3-prompts.ts` | One segment per act; 3 row-strip refs; updated referenceDesc |
| `src/tests/smoke.ts` | Update buildSeedancePrompt test to 9-shot fixture + row-header assertions |

---

## Task 1: Add row headers to video prompt builder

**Files:**
- Modify: `src/prompts/video-shot.ts` (SHOT SEQUENCE section, ~line 66)
- Modify: `src/tests/smoke.ts` (Video shot section, ~line 162)

- [ ] **Step 1: Update smoke test to use a 9-shot fixture and assert row headers**

Replace the entire `// Video shot (Seedance prompt)` block in `src/tests/smoke.ts` with:

```typescript
{
  // Video shot (Seedance prompt) — 9-shot fixture verifies row grouping headers
  const shots9: ShotSpec[] = Array.from({ length: 9 }, (_, i) => ({
    id: i + 1,
    time: `0:${String(Math.round(i * 15 / 9)).padStart(2, "0")}-0:${String(Math.round((i + 1) * 15 / 9)).padStart(2, "0")}`,
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
    referenceDesc: "[Image1] is Row 1 storyboard\n[Image2] is Row 2\n[Image3] is Row 3",
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
```

- [ ] **Step 2: Run smoke test to confirm it fails**

```bash
pnpm test
```

Expected: `✗ row 1 header present` (and similar for rows 2 and 3).

- [ ] **Step 3: Add `SHOTS_PER_ROW` constant and row header emission in `src/prompts/video-shot.ts`**

At the top of the file (after imports), add the constant:

```typescript
const SHOTS_PER_ROW = 3;
```

Replace the SHOT SEQUENCE `for` loop (currently starts around line 66 with `parts.push("SHOT SEQUENCE:")`):

```typescript
  // 6. SHOTS
  parts.push("SHOT SEQUENCE:");
  const numRows = Math.ceil(config.shots.length / SHOTS_PER_ROW);
  const rowDuration = config.totalDuration / numRows;
  for (let i = 0; i < config.shots.length; i++) {
    if (i % SHOTS_PER_ROW === 0) {
      const rowNum = Math.floor(i / SHOTS_PER_ROW) + 1;
      const rowStart = Math.round((rowNum - 1) * rowDuration);
      const rowEnd = Math.round(rowNum * rowDuration);
      parts.push(`[Row ${rowNum} — ${rowStart}–${rowEnd}s]`);
    }

    const shot = config.shots[i];
    const shotNum = i + 1;
    const time = shot.time;
    const shotType = shot.type ?? "";
    const camera = shot.camera ?? "";
    const title = shot.title ?? "";

    let header = `Shot ${shotNum} (${time})`;
    if (shotType) header += ` [${shotType}]`;
    if (camera) header += ` • ${camera}`;
    if (title) header += ` — ${title}`;
    parts.push(header);

    parts.push(shot.action);

    if (shot.physics) {
      parts.push(shot.physics);
    }

    parts.push("");
  }
```

- [ ] **Step 4: Run smoke test to confirm it passes**

```bash
pnpm test
```

Expected: all assertions pass, including `✓ row 1 header present`.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/prompts/video-shot.ts src/tests/smoke.ts
git commit -m "feat: add temporal row headers to Seedance SHOT SEQUENCE prompt"
```

---

## Task 2: Update screenplay LLM prompt for 9 shots/act

**Files:**
- Modify: `src/prompts/screenplay.ts`
- Modify: `src/tests/smoke.ts` (screenplay section, ~line 130)

- [ ] **Step 1: Update smoke test to assert numActs in user prompt**

In `src/tests/smoke.ts`, find the `// Screenplay` block and replace the assertions:

```typescript
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
  assert(msgs[1].content.includes("Whiskers"), "user message includes character");
  assert(msgs[1].content.includes("60"), "user message includes duration");
  assert(msgs[1].content.includes("9 shots"), "user message specifies 9 shots");
  assert(msgs[1].content.includes("4 acts"), "user message includes numActs for 60s");
}
```

- [ ] **Step 2: Run to confirm new assertions fail**

```bash
pnpm test
```

Expected: `✗ user message specifies 9 shots`.

- [ ] **Step 3: Update SYSTEM_PROMPT requirements 1–3 in `src/prompts/screenplay.ts`**

Replace KEY REQUIREMENTS section 1–3 (the block from `1. SHOTS PER ACT` through the end of `3. TRANSITION HINTS`) with:

```
1. SHOTS PER ACT: Each act MUST contain EXACTLY 9 shots — no more, no fewer. This is a hard requirement for the storyboard pipeline. The 9 shots are arranged in a 3×3 grid (3 columns, 3 rows of 3), where each row of 3 shots covers a 5-second temporal window within the 15-second video. Each shot is approximately 1.5–2 seconds long (9 shots × ~1.67s ≈ 15s per act).

2. TOTAL DURATION: The total number of acts is given in the user message — generate exactly that many acts, each with a durationTarget of 15 seconds. The sum of all act durationTargets must equal the requested total duration.

3. TRANSITION HINTS: Insert a transition hint at the last shot of each act except the final one (every 9 shots = every 15 seconds). Choose the strategy based on the narrative context at the act boundary:
   - "first_frame_anchor" — same scene, continuous action crossing the act cut (chases, fights)
   - "occlusion_transition" — scene change (use physical occlusion to mask the cut)
   - "continuity_crossfade" — same scene, different action (default, 0.3s crossfade)
   - "hard_cut" — montage, fast pace, deliberate jump
```

- [ ] **Step 4: Update `buildScreenplayPrompt` function body to compute and pass `numActs`**

Replace the `buildScreenplayPrompt` function body (from `const characterList` through `return [...]`):

```typescript
export function buildScreenplayPrompt(
  story: string,
  characters: CharacterInput[],
  duration: number,
  style: string,
): Array<{ role: "system" | "user"; content: string }> {
  const characterList = characters
    .map((c) => {
      let line = `- ${c.name}`;
      if (c.imagePath) line += ` (has reference image)`;
      return line;
    })
    .join("\n");

  const numActs = Math.ceil(duration / 15);

  const userPrompt = `Generate a complete structured screenplay for the following film:

STORY:
${story}

CHARACTERS:
${characterList}

TARGET DURATION: ${duration} seconds
VISUAL STYLE: ${style}

Produce the JSON screenplay now. Remember:
- Each act MUST have EXACTLY 9 shots
- Each shot ~1.67 seconds (9 shots × ~1.67s ≈ 15s per act)
- Total number of acts: ${numActs} (${numActs} × 15s = ${numActs * 15}s)
- Include transitionHints at each act boundary (after the last shot of each act except the final)
- Character descriptions must be detailed enough for image generation prompts
- Action descriptions must be visual and camera-oriented`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}
```

- [ ] **Step 5: Run smoke test to confirm all pass**

```bash
pnpm test
```

Expected: `✓ user message specifies 9 shots` and `✓ user message includes numActs for 60s`.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/prompts/screenplay.ts src/tests/smoke.ts
git commit -m "feat: update screenplay prompt for 9-shot 3x3 acts with numActs derivation"
```

---

## Task 3: Update storyboard grid columns

**Files:**
- Modify: `src/pipeline/stages/2-storyboard.ts` (line 10)

- [ ] **Step 1: Change `GRID_COLS` from 4 to 3**

```typescript
const GRID_COLS = 3;
```

- [ ] **Step 2: Typecheck and smoke test**

```bash
pnpm typecheck && pnpm test
```

Expected: no errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/stages/2-storyboard.ts
git commit -m "feat: storyboard grid cols 4 → 3 for 3x3 layout"
```

---

## Task 4: Update screenplay stage validation to 9 shots

**Files:**
- Modify: `src/pipeline/stages/0-screenplay.ts` (~line 46)

- [ ] **Step 1: Change shot count validation**

Find and replace:

```typescript
    if (act.shots.length !== 12) {
      throw new Error(
        `Act ${act.act} has ${act.shots.length} shots but must have exactly 12`,
      );
    }
```

With:

```typescript
    if (act.shots.length !== 9) {
      throw new Error(
        `Act ${act.act} has ${act.shots.length} shots but must have exactly 9`,
      );
    }
```

- [ ] **Step 2: Typecheck and smoke test**

```bash
pnpm typecheck && pnpm test
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/stages/0-screenplay.ts
git commit -m "feat: validate 9 shots per act in screenplay stage"
```

---

## Task 5: Refactor prompts stage — one segment per act, three row refs

**Files:**
- Modify: `src/pipeline/stages/3-prompts.ts`

- [ ] **Step 1: Update top constants**

Replace the three constants at the top of `runPromptsStage`:

```typescript
const SHOTS_PER_ROW = 3;
const ROWS_PER_ACT = 3;
const SEGMENT_DURATION = 15;
const ROW_DURATION = SEGMENT_DURATION / ROWS_PER_ACT; // 5s per row
```

- [ ] **Step 2: Replace `assembleReferenceImages` to accept an array of row paths**

Replace the entire `assembleReferenceImages` function:

```typescript
function assembleReferenceImages(
  rowImagePaths: string[],
  screenplay: Screenplay,
  charRefMap: Map<string, string>,
): string[] {
  const refs: string[] = [];

  for (const rowPath of rowImagePaths) {
    if (fs.existsSync(rowPath)) refs.push(rowPath);
  }

  for (const char of screenplay.characters) {
    if (refs.length >= MAX_REFERENCE_IMAGES) break;
    const refPath = charRefMap.get(char.name);
    if (refPath) refs.push(refPath);
  }

  return refs;
}
```

- [ ] **Step 3: Replace `buildReferenceDescription` to map rows to temporal windows**

Replace the entire `buildReferenceDescription` function:

```typescript
function buildReferenceDescription(
  actNum: number,
  rowImagePaths: string[],
  screenplay: Screenplay,
  charRefMap: Map<string, string>,
): string {
  const parts: string[] = [];
  let imgIdx = 1;

  for (let rowIdx = 0; rowIdx < ROWS_PER_ACT; rowIdx++) {
    const rowPath = rowImagePaths[rowIdx];
    if (rowPath && fs.existsSync(rowPath)) {
      const rowNum = rowIdx + 1;
      const startS = rowIdx * ROW_DURATION;
      const endS = (rowIdx + 1) * ROW_DURATION;
      const first = rowIdx * SHOTS_PER_ROW + 1;
      const last = (rowIdx + 1) * SHOTS_PER_ROW;
      parts.push(
        `[Image${imgIdx}] is the storyboard row for Act ${actNum} Row ${rowNum}, showing shots ${first}–${last} (${startS}–${endS}s) — use for composition and choreography.`,
      );
      imgIdx++;
    }
  }

  for (const char of screenplay.characters) {
    if (imgIdx > MAX_REFERENCE_IMAGES) break;
    if (charRefMap.has(char.name)) {
      parts.push(`[Image${imgIdx}] is ${char.name}: ${char.detailedDescription}`);
      imgIdx++;
    } else {
      parts.push(`${char.name}: ${char.detailedDescription}`);
    }
  }

  return parts.join("\n");
}
```

- [ ] **Step 4: Update `buildIntent` — remove `rowNum` parameter**

Replace the entire `buildIntent` function:

```typescript
function buildIntent(
  act: { act: number; name: string },
  segmentId: number,
  totalSegments: number,
): string {
  return `Segment ${segmentId} of ${totalSegments} — Act ${act.act} (${act.name}).`;
}
```

- [ ] **Step 5: Rewrite the main loop in `runPromptsStage` — one segment per act**

Replace the entire `for (const act of screenplay.acts)` loop (and the `let segmentId`, `let prevLastShot` declarations before it) with:

```typescript
  const artifacts: Record<string, string> = {};
  let segmentId = 0;
  let prevLastShot: (ShotSpec & { actNumber: number }) | undefined;

  for (const act of screenplay.acts) {
    segmentId++;

    const rowImagePaths = [1, 2, 3].map((rowNum) =>
      path.join(storyboardDir, `act-${act.act}-row-${rowNum}.png`),
    );

    const shotsWithAct = act.shots.map((s) => ({ ...s, actNumber: act.act }));

    const transitionStrategy = determineTransitionStrategy(
      shotsWithAct,
      segmentId,
      transitionHintMap,
      prevLastShot,
    );

    const referenceImageRefs = assembleReferenceImages(
      rowImagePaths,
      screenplay,
      charRefMap,
    );

    const referenceDesc = buildReferenceDescription(
      act.act,
      rowImagePaths,
      screenplay,
      charRefMap,
    );

    const totalSegments = screenplay.acts.length;
    const intent = buildIntent(act, segmentId, totalSegments);
    const rules = buildRules(shotsWithAct, screenplay);
    const cameraNotes = buildCameraNotes(shotsWithAct);
    const soundDesign = buildSoundDesign(shotsWithAct);
    const negatives = buildNegatives(shotsWithAct);
    const endState = buildEndState(shotsWithAct);
    const continuityNote = buildContinuityNote(
      shotsWithAct,
      segmentId,
      prevLastShot,
    );

    const config: VideoPromptConfig = {
      segmentId,
      mode: "modeB",
      transitionStrategy,
      intent,
      referenceDesc,
      rules,
      shots: act.shots,
      style: state.config.style,
      cameraNotes,
      soundDesign,
      negatives,
      endState,
      continuityNote,
      totalDuration: SEGMENT_DURATION,
      seed: state.config.seed,
    };

    if (referenceImageRefs.length > 0) {
      config.referenceImageRefs = referenceImageRefs;
    }

    const promptText = buildSeedancePrompt(config);

    const outPath = path.join(promptsDir, `segment-${segmentId}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ ...config, prompt: promptText }, null, 2),
      "utf-8",
    );
    artifacts[`prompts/segment-${segmentId}.json`] =
      `prompts/segment-${segmentId}.json`;

    prevLastShot = shotsWithAct[shotsWithAct.length - 1];
  }

  return { artifacts };
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors. If TypeScript complains about unused imports (`ROWS_PER_ACT` referenced but `rowIdx` loop removed, etc.), remove them.

- [ ] **Step 7: Run smoke test**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/stages/3-prompts.ts
git commit -m "feat: prompts stage — one segment per act with three row reference images"
```
