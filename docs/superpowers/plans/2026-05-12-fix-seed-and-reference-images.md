# Fix Seed & Reference Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two pipeline bugs: (1) character image generation ignores `seed`, causing style inconsistency across characters; (2) video generation passes local file paths for `reference_images`, so the Seedance API never receives character reference images.

**Architecture:** Two minimal, independent fixes. Task 1 adds `seed` to `ImageOptions` in `volcengine.ts` and exports a pure `imagePathToDataUri()` helper. Tasks 2–3 wire these into the two affected pipeline stages. Task 4 validates with a smoke test. Task 5 validates with integration tests. No new files, no new abstractions.

**Tech Stack:** TypeScript strict ESM (imports use `.js` extensions), OpenAI SDK (Volcengine proxy), Node.js `fs`/`path`/`Buffer`, `pnpm test` (smoke, no API key), `pnpm test:api:quick` (integration, requires `VOLC_API_KEY`).

---

### Task 1: Add `seed` and `imagePathToDataUri` to `volcengine.ts`

**Files:**
- Modify: `src/providers/volcengine.ts`

- [ ] **Step 1: Add `seed` to `ImageOptions` and pass it in `generateImage()`**

In `src/providers/volcengine.ts`, replace the `ImageOptions` interface and `generateImage()` function (lines 48–69):

```typescript
export interface ImageOptions {
  size?: string;    // "1920x1920" | "1536x1024" | "1024x1536" (min 3,686,400 pixels)
  quality?: string; // "standard" | "hd"
  seed?: number;    // for reproducibility — same seed + same prompt = same image
}

export async function generateImage(
  prompt: string,
  options?: ImageOptions,
): Promise<Buffer> {
  const client = getClient();
  const response = await client.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: (options?.size ??
      "1920x1920") as OpenAI.Images.ImageGenerateParams["size"],
    n: 1,
    response_format: "b64_json",
    ...(options?.seed !== undefined && { seed: options.seed }),
  } as Parameters<typeof client.images.generate>[0]);

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in response");
  return Buffer.from(b64, "base64");
}
```

- [ ] **Step 2: Add `imagePathToDataUri()` at the bottom of `volcengine.ts`**

Append after the `saveBuffer` export (end of file):

```typescript
/** Read a local image file and return it as a base64 data URI. */
export function imagePathToDataUri(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}
```

All character refs are saved as `.png` (`1-characters.ts` uses `${char.name}-ref.png`), so hardcoding `image/png` is correct here.

- [ ] **Step 3: Verify type check passes**

```bash
pnpm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/providers/volcengine.ts
git commit -m "feat: add seed to generateImage and imagePathToDataUri helper"
```

---

### Task 2: Wire `seed` in Stage 1 characters

**Files:**
- Modify: `src/pipeline/stages/1-characters.ts`

- [ ] **Step 1: Pass `seed` when calling `generateImage()`**

In `src/pipeline/stages/1-characters.ts`, replace lines 50–52:

```typescript
// Before:
const prompt = buildCharacterSheetPrompt(char, state.config.style);
const buffer = await generateImage(prompt);

// After:
const prompt = buildCharacterSheetPrompt(char, state.config.style);
const buffer = await generateImage(prompt, { seed: state.config.seed });
```

- [ ] **Step 2: Verify type check passes**

```bash
pnpm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run smoke tests**

```bash
pnpm run test
```

Expected: all existing assertions pass (smoke tests don't call `generateImage`).

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/stages/1-characters.ts
git commit -m "feat: pass seed to character image generation"
```

---

### Task 3: Convert reference image paths to base64 in Stage 4

**Files:**
- Modify: `src/pipeline/stages/4-video-gen.ts`

- [ ] **Step 1: Add `imagePathToDataUri` to the volcengine import**

In `src/pipeline/stages/4-video-gen.ts`, find the volcengine import block (lines 7–11):

```typescript
// Before:
import {
  downloadFile,
  pollVideoTask,
  submitVideoTask,
} from "../../providers/volcengine.js";

// After:
import {
  downloadFile,
  imagePathToDataUri,
  pollVideoTask,
  submitVideoTask,
} from "../../providers/volcengine.js";
```

- [ ] **Step 2: Replace the modeB block with base64 conversion**

In `src/pipeline/stages/4-video-gen.ts`, replace lines 67–71:

```typescript
// Before:
} else if (config.mode === "modeB") {
  // TODO: Same as above — reference_images may need URL conversion.
  if (config.referenceImageRefs?.length) {
    params.reference_images = config.referenceImageRefs;
  }
}

// After:
} else if (config.mode === "modeB") {
  if (config.referenceImageRefs?.length) {
    params.reference_images = config.referenceImageRefs.map(imagePathToDataUri);
  }
}
```

- [ ] **Step 3: Verify type check passes**

```bash
pnpm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Run smoke tests**

```bash
pnpm run test
```

Expected: all existing assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/stages/4-video-gen.ts
git commit -m "fix: convert reference image paths to base64 data URIs for video API"
```

---

### Task 4: Add smoke test for `imagePathToDataUri`

**Files:**
- Modify: `src/tests/smoke.ts`

- [ ] **Step 1: Add `imagePathToDataUri` to imports**

In `src/tests/smoke.ts`, add to the existing imports block (after the other imports):

```typescript
import { imagePathToDataUri } from "../providers/volcengine.js";
```

- [ ] **Step 2: Add test section before the summary block**

In `src/tests/smoke.ts`, add this section immediately before `// ─── Summary ───`:

```typescript
// ─── 4. imagePathToDataUri ───

console.log("\n=== imagePathToDataUri ===");
{
  const tmpFile = path.join(os.tmpdir(), "ai-films-test-img.png");
  const testContent = Buffer.from("fake-png-content-for-testing");
  fs.writeFileSync(tmpFile, testContent);

  const dataUri = imagePathToDataUri(tmpFile);

  assert(
    dataUri.startsWith("data:image/png;base64,"),
    "imagePathToDataUri: correct data URI prefix for .png",
  );

  const decoded = Buffer.from(dataUri.split(",")[1], "base64");
  assert(
    decoded.equals(testContent),
    "imagePathToDataUri: decoded bytes match original file content",
  );

  fs.unlinkSync(tmpFile);
}
```

- [ ] **Step 3: Run smoke tests**

```bash
pnpm run test
```

Expected: all previous assertions pass + 2 new assertions for `imagePathToDataUri`.

- [ ] **Step 4: Commit**

```bash
git add src/tests/smoke.ts
git commit -m "test: add smoke assertions for imagePathToDataUri"
```

---

### Task 5: Add integration tests for seed and base64 reference images

**Files:**
- Modify: `src/tests/integration.ts`

Requires `VOLC_API_KEY` set in environment. Run with `pnpm test:api:quick`.

- [ ] **Step 1: Add `imagePathToDataUri` to the volcengine import in `integration.ts`**

In `src/tests/integration.ts`, find the volcengine import (lines 26–30):

```typescript
// Before:
import {
  chat,
  generateImage,
  saveBuffer,
  submitVideoTask,
} from "../providers/volcengine.js";

// After:
import {
  chat,
  generateImage,
  imagePathToDataUri,
  saveBuffer,
  submitVideoTask,
} from "../providers/volcengine.js";
```

- [ ] **Step 2: Add seed test inside the Stage 1 block**

In `src/tests/integration.ts`, inside the `if (stageFilter === "all" || stageFilter === "1")` block, add after the first `generateImage` test (after line 135):

```typescript
await test("generateImage with seed accepts options without error", async () => {
  const buffer = await generateImage(
    "A single white circle on a black background",
    { size: "1920x1920", seed: 42 },
  );
  if (buffer.length < 1000) throw new Error("Image too small");
  console.log(`    Seeded image: ${(buffer.length / 1024).toFixed(0)} KB`);
});
```

- [ ] **Step 3: Add base64 reference_images test inside the Stage 2 block**

In `src/tests/integration.ts`, inside the `if (stageFilter === "all" || stageFilter === "2")` block, add after the existing `submitVideoTask` test (after line 168):

```typescript
await test("submitVideoTask accepts base64 data URI as reference_image", async () => {
  // Use a real generated image so the API receives a valid PNG
  const refBuffer = await generateImage("A white circle on black", {
    size: "1920x1920",
  });
  const tmpRef = path.join(tmpDir, "integ-char-ref.png");
  saveBuffer(refBuffer, tmpRef);

  const dataUri = imagePathToDataUri(tmpRef);
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
```

⚠️ **If this test fails** with a 4xx API error about `reference_images` format, the Seedance API does not support base64 data URIs — a file upload mechanism to obtain public URLs will be required (separate plan).

- [ ] **Step 4: Run integration tests in quick mode**

```bash
pnpm test:api:quick
```

Expected: all tests pass. The base64 reference_images test definitively confirms whether the Volcengine API accepts this format.

- [ ] **Step 5: Commit**

```bash
git add src/tests/integration.ts
git commit -m "test: verify seed in generateImage and base64 reference_images in submitVideoTask"
```

---

## Self-Review

**Spec coverage:**
- ✅ `seed` added to `ImageOptions` and passed in `generateImage()` — Task 1
- ✅ Seed wired into Stage 1 `1-characters.ts` — Task 2
- ✅ `imagePathToDataUri` helper added and exported — Task 1
- ✅ Reference images converted to base64 in `4-video-gen.ts` — Task 3
- ✅ Smoke test for `imagePathToDataUri` round-trip — Task 4
- ✅ Integration test for seed + base64 reference_images — Task 5

**Placeholder scan:** No TBD, TODO, or incomplete steps.

**Type consistency:** `ImageOptions.seed: number` defined in Task 1, used in Task 2. `imagePathToDataUri` exported in Task 1, imported by name in Tasks 3, 4, 5 — identical identifier throughout.

**Key risk:** Task 5 Step 4 is the go/no-go gate for the base64 approach. If the Volcengine Seedance 2.0 API rejects `data:image/png;base64,...` strings in `reference_images`, a separate URL-upload plan is needed.
