# Cross-Act Visual Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen cross-act visual continuity in the modeB pipeline so that consecutive 15s clips look like one continuous film — matching background, lighting, color palette, camera angle, and character poses at act boundaries.

**Architecture:** Four reinforcement layers all in modeB: (1) strengthen the Image1 last-frame description and add a hard continuity rule, (2) inject the previous act's storyboard row-3 strip as an environment reference, (3) replace the generic continuityNote with scene-aware detailed visual instructions, (4) upgrade stage 4's per-segment injection to apply all three layers before generating the next segment.

**Tech Stack:** TypeScript, Node.js fs, existing `buildSeedancePrompt` prompt builder

---

## File Structure

| File | Role |
|------|------|
| `src/pipeline/stages/3-prompts.ts` (modify) | Layers 1–3: enhanced descriptions, row-3 ref, scene-aware continuityNote, hard rule |
| `src/pipeline/stages/4-video-gen.ts` (modify) | Layer 4: enhanced injection that applies all layers at runtime |

No new files. No type changes required — `VideoPromptConfig` already has all needed fields.

---

### Task 1: Layer 1 — Strengthen Image1 description in `buildReferenceDescription`

**Files:**
- Modify: `src/pipeline/stages/3-prompts.ts:189-193`

- [ ] **Step 1: Update the Image1 description text**

In `buildReferenceDescription`, replace the current weak description inside the `if (hasPrevLastFrame)` block (lines 189–193):

```typescript
  if (hasPrevLastFrame) {
    parts.push(
      `[Image${imgIdx}] is the EXACT last frame of the previous clip. Your opening frames MUST match this image — same background, same lighting, same color palette, same character positions, same camera angle. This is the highest-priority reference.`,
    );
    imgIdx++;
  }
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/stages/3-prompts.ts
git commit -m "feat(prompts): strengthen Image1 last-frame description for cross-act continuity"
```

---

### Task 2: Layer 1 — Add hard continuity rule in `buildRules`

**Files:**
- Modify: `src/pipeline/stages/3-prompts.ts:275-317` (the `buildRules` function)
- Modify: `src/pipeline/stages/3-prompts.ts:97-99` (the call site in `runPromptsStage`)

- [ ] **Step 1: Add `segmentId` and `hasPrevLastFrame` parameters to `buildRules`**

Change the function signature and add the rule at the end of the function body, before `return rules`:

```typescript
function buildRules(
  shots: Array<ShotSpec & { actNumber: number }>,
  screenplay: Screenplay,
  segmentId: number,
  hasPrevLastFrame: boolean,
): string[] {
  const rules: string[] = [];

  // ... existing rule-building code unchanged ...

  if (segmentId > 1 && hasPrevLastFrame) {
    rules.push(
      `The first 2 seconds of this clip must be visually continuous with [Image1] — match the background, lighting, color temperature, and character positions exactly.`,
    );
  }

  return rules;
}
```

- [ ] **Step 2: Update the call site in `runPromptsStage`**

Change line 99 from:

```typescript
    const rules = buildRules(shotsWithAct, screenplay);
```

to:

```typescript
    const rules = buildRules(shotsWithAct, screenplay, segmentId, hasPrevLastFrame);
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/stages/3-prompts.ts
git commit -m "feat(prompts): add hard continuity rule for first 2 seconds to match Image1"
```

---

### Task 3: Layer 2 — Inject previous act's row-3 storyboard strip

**Files:**
- Modify: `src/pipeline/stages/3-prompts.ts:58-95` (the loop in `runPromptsStage`)
- Modify: `src/pipeline/stages/3-prompts.ts:153-177` (`assembleReferenceImages`)
- Modify: `src/pipeline/stages/3-prompts.ts:179-224` (`buildReferenceDescription`)

- [ ] **Step 1: Compute `prevRow3Path` in the main loop**

After the existing `prevLastFramePath` computation (lines 65–68), add:

```typescript
    const prevRow3Path =
      segmentId > 1
        ? path.join(storyboardDir, `act-${act.act - 1}-row-3.png`)
        : undefined;
```

- [ ] **Step 2: Pass `prevRow3Path` to `assembleReferenceImages`**

Update the call (lines 79–84):

```typescript
    const referenceImageRefs = assembleReferenceImages(
      rowImagePaths,
      screenplay,
      charRefMap,
      prevLastFramePath,
      prevRow3Path,
    );
```

- [ ] **Step 3: Update `assembleReferenceImages` to accept and insert `prevRow3Path`**

```typescript
function assembleReferenceImages(
  rowImagePaths: string[],
  screenplay: Screenplay,
  charRefMap: Map<string, string>,
  prevLastFramePath: string | undefined,
  prevRow3Path: string | undefined,
): string[] {
  const refs: string[] = [];

  if (prevLastFramePath && fs.existsSync(prevLastFramePath)) {
    refs.push(prevLastFramePath);
  }

  if (prevRow3Path && fs.existsSync(prevRow3Path)) {
    refs.push(prevRow3Path);
  }

  for (const rowPath of rowImagePaths) {
    if (refs.length >= MAX_REFERENCE_IMAGES) break;
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

- [ ] **Step 4: Compute `hasPrevRow3` and pass to `buildReferenceDescription`**

After `hasPrevLastFrame` (line 86–87), add:

```typescript
    const hasPrevRow3 =
      prevRow3Path !== undefined && fs.existsSync(prevRow3Path);
```

Update the call to `buildReferenceDescription` (lines 89–95):

```typescript
    const referenceDesc = buildReferenceDescription(
      act.act,
      rowImagePaths,
      screenplay,
      charRefMap,
      hasPrevLastFrame,
      hasPrevRow3,
    );
```

- [ ] **Step 5: Update `buildReferenceDescription` to include Image2 (prev row-3)**

Add the `hasPrevRow3` parameter and a new block after the `hasPrevLastFrame` block:

```typescript
function buildReferenceDescription(
  actNum: number,
  rowImagePaths: string[],
  screenplay: Screenplay,
  charRefMap: Map<string, string>,
  hasPrevLastFrame: boolean,
  hasPrevRow3: boolean,
): string {
  const parts: string[] = [];
  let imgIdx = 1;

  if (hasPrevLastFrame) {
    parts.push(
      `[Image${imgIdx}] is the EXACT last frame of the previous clip. Your opening frames MUST match this image — same background, same lighting, same color palette, same character positions, same camera angle. This is the highest-priority reference.`,
    );
    imgIdx++;
  }

  if (hasPrevRow3) {
    parts.push(
      `[Image${imgIdx}] is the storyboard strip for the ENDING of the previous act — use to maintain environment consistency (walls, furniture, lighting direction).`,
    );
    imgIdx++;
  }

  // ... rest of function unchanged (storyboard rows + character refs) ...
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/stages/3-prompts.ts
git commit -m "feat(prompts): inject previous act's row-3 storyboard strip as environment reference"
```

---

### Task 4: Layer 3 — Enhanced scene-aware `buildContinuityNote`

**Files:**
- Modify: `src/pipeline/stages/3-prompts.ts:366-393` (the `buildContinuityNote` function)
- Modify: `src/pipeline/stages/3-prompts.ts:104-108` (the call site)

- [ ] **Step 1: Add `hasPrevLastFrame` parameter and rewrite `buildContinuityNote`**

Replace the entire function:

```typescript
function buildContinuityNote(
  shots: Array<ShotSpec & { actNumber: number }>,
  segmentId: number,
  prevLastShot: (ShotSpec & { actNumber: number }) | undefined,
  hasPrevLastFrame: boolean,
): string | undefined {
  if (segmentId === 1 || !prevLastShot) return undefined;

  const sameScene =
    shots[0]?.scene &&
    prevLastShot.scene &&
    shots[0].scene === prevLastShot.scene;

  if (hasPrevLastFrame && sameScene) {
    return [
      "VISUAL CONTINUITY — SAME SCENE:",
      "[Image1] shows exactly where the previous clip ended. Your opening frames must match:",
      "• Background: identical walls, furniture, objects, spatial layout",
      "• Lighting: same direction, intensity, and color temperature",
      "• Camera: same angle and distance from subjects",
      "• Characters: same positions and poses as shown in [Image1]",
      `Action continues from: ${prevLastShot.action}`,
    ].join("\n");
  }

  if (hasPrevLastFrame && !sameScene) {
    return [
      "VISUAL CONTINUITY — SCENE TRANSITION:",
      "[Image1] shows the previous clip's ending. Transition smoothly to the new scene while:",
      "• Maintaining consistent character appearance and costume",
      "• Using a natural transition (the character walks/turns to reveal the new environment)",
      `Action continues from: ${prevLastShot.action}`,
    ].join("\n");
  }

  // Fallback: no last frame available (first pipeline run, stage 3 pass)
  const parts = [
    "This clip must feel like a direct continuation of the previous clip.",
    `Start with: ${prevLastShot.action}`,
  ];
  if (sameScene) {
    parts.push(
      "Maintain the same scene, same lighting, same camera distance, and same emotional tone.",
    );
  } else {
    parts.push(
      "Transition smoothly to the new scene while maintaining character appearance.",
    );
  }
  return parts.join(" ");
}
```

- [ ] **Step 2: Update the call site in `runPromptsStage`**

Change lines 104–108 from:

```typescript
    const continuityNote = buildContinuityNote(
      shotsWithAct,
      segmentId,
      prevLastShot,
    );
```

to:

```typescript
    const continuityNote = buildContinuityNote(
      shotsWithAct,
      segmentId,
      prevLastShot,
      hasPrevLastFrame,
    );
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/stages/3-prompts.ts
git commit -m "feat(prompts): scene-aware continuityNote with detailed visual matching instructions"
```

---

### Task 5: Layer 4 — Enhanced stage 4 injection

**Files:**
- Modify: `src/pipeline/stages/4-video-gen.ts:129-155` (the injection block)

- [ ] **Step 1: Replace the existing injection block**

Replace the entire `// h. Inject last frame into next segment's prompt` block (lines 129–155) with:

```typescript
    // h. Inject last frame + enhanced continuity into next segment's prompt
    const nextPromptPath = path.join(
      promptsDir,
      `segment-${segmentId + 1}.json`,
    );
    if (fs.existsSync(nextPromptPath)) {
      const nextConfig: VideoPromptConfig = JSON.parse(
        fs.readFileSync(nextPromptPath, "utf-8"),
      );
      const alreadyHas = nextConfig.referenceImageRefs?.some((r) =>
        r.endsWith(`segment-${segmentId}-last.png`),
      );
      if (!alreadyHas) {
        // 1. Prepend last frame + prev row-3 to referenceImageRefs
        const storyboardDir = path.join(projectDir, "storyboard");
        const currentActNumber = segmentId; // acts and segments are 1:1
        const prevRow3Path = path.join(
          storyboardDir,
          `act-${currentActNumber}-row-3.png`,
        );
        const newRefs: string[] = [lastFramePath];
        if (fs.existsSync(prevRow3Path)) {
          newRefs.push(prevRow3Path);
        }
        const existingRefs = nextConfig.referenceImageRefs ?? [];
        nextConfig.referenceImageRefs = [...newRefs, ...existingRefs];

        // 2. Rebuild referenceDesc with enhanced Image1 + optional Image2, shift existing indices
        const shiftCount = newRefs.length;
        const shiftedDesc = nextConfig.referenceDesc.replace(
          /\[Image(\d+)\]/g,
          (_, n) => `[Image${Number(n) + shiftCount}]`,
        );
        const descParts: string[] = [
          `[Image1] is the EXACT last frame of the previous clip. Your opening frames MUST match this image — same background, same lighting, same color palette, same character positions, same camera angle. This is the highest-priority reference.`,
        ];
        if (fs.existsSync(prevRow3Path)) {
          descParts.push(
            `[Image2] is the storyboard strip for the ENDING of the previous act — use to maintain environment consistency (walls, furniture, lighting direction).`,
          );
        }
        descParts.push(shiftedDesc);
        nextConfig.referenceDesc = descParts.join("\n");

        // 3. Replace continuityNote with enhanced scene-aware version
        const currentLastShot = config.shots[config.shots.length - 1];
        const nextFirstShot = nextConfig.shots[0];
        const sameScene =
          currentLastShot?.scene &&
          nextFirstShot?.scene &&
          currentLastShot.scene === nextFirstShot.scene;
        if (sameScene) {
          nextConfig.continuityNote = [
            "VISUAL CONTINUITY — SAME SCENE:",
            "[Image1] shows exactly where the previous clip ended. Your opening frames must match:",
            "• Background: identical walls, furniture, objects, spatial layout",
            "• Lighting: same direction, intensity, and color temperature",
            "• Camera: same angle and distance from subjects",
            "• Characters: same positions and poses as shown in [Image1]",
            `Action continues from: ${currentLastShot.action}`,
          ].join("\n");
        } else {
          nextConfig.continuityNote = [
            "VISUAL CONTINUITY — SCENE TRANSITION:",
            "[Image1] shows the previous clip's ending. Transition smoothly to the new scene while:",
            "• Maintaining consistent character appearance and costume",
            "• Using a natural transition (the character walks/turns to reveal the new environment)",
            `Action continues from: ${currentLastShot?.action ?? "the previous scene"}`,
          ].join("\n");
        }

        // 4. Append hard continuity rule if not already present
        const continuityRule =
          "The first 2 seconds of this clip must be visually continuous with [Image1] — match the background, lighting, color temperature, and character positions exactly.";
        if (!nextConfig.rules.includes(continuityRule)) {
          nextConfig.rules.push(continuityRule);
        }

        // 5. Rebuild prompt and save
        const updatedPrompt = buildSeedancePrompt(nextConfig);
        fs.writeFileSync(
          nextPromptPath,
          JSON.stringify({ ...nextConfig, prompt: updatedPrompt }, null, 2),
          "utf-8",
        );
        console.log(
          `[video-gen] injected last frame + continuity layers of segment ${segmentId} into segment ${segmentId + 1} prompts`,
        );
      }
    }
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: no errors

- [ ] **Step 3: Run lint**

Run: `pnpm run lint`
Expected: no new warnings in the modified files

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/stages/4-video-gen.ts
git commit -m "feat(video-gen): enhanced injection with all 4 continuity layers for next segment"
```

---

### Task 6: Verify end-to-end prompt output

- [ ] **Step 1: Run typecheck and lint on the full project**

Run: `pnpm run typecheck && pnpm run lint`
Expected: no new errors or warnings in `3-prompts.ts` or `4-video-gen.ts`

- [ ] **Step 2: Inspect an existing project's prompt output (dry run)**

If a project with storyboard rows exists, run the pipeline up to stage 3 to verify the prompt JSON structure:

Run: `pnpm run dev -- --project <existing-project-id> --from prompts --to prompts`

Then inspect `prompts/segment-2.json`:
- `referenceImageRefs` should list: `[prevLastFrame (if exists), prevRow3 (if exists), row-1, row-2, row-3, char-refs...]`
- `referenceDesc` should show enhanced `[Image1]` text with "EXACT last frame" and "highest-priority reference"
- `continuityNote` should contain "VISUAL CONTINUITY — SAME SCENE:" or "SCENE TRANSITION:" format
- `rules` should include the "first 2 seconds" continuity rule

- [ ] **Step 3: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: final adjustments after end-to-end verification"
```
