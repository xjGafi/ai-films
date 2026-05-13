# Cross-Act Visual Continuity — Enhanced modeB Multi-Layer Anchoring

## Problem

A 1-minute, 4-act short film generates 4 independent 15s video clips via Seedance 2.0. All acts share the same scene, yet the generated clips exhibit:

- Background/environment jumps (same "lab" looks like different locations)
- Color palette and lighting discontinuity
- Camera angle/distance jumps between act endings and next act openings
- Character pose/action breaks at act boundaries

Root cause: cross-act visual continuity relies solely on text-based `continuityNote` in the prompt. The video model has no **image-level anchor** for what the previous clip looked like.

## Constraints

- Seedance API's `image` (modeA) and `reference_images` (modeB) are mutually exclusive — cannot pass both.
- Stay within modeB (reference_images approach) for all segments.
- No additional image generation API calls (no GPT Image 2 keyframe generation in this iteration).
- `MAX_REFERENCE_IMAGES = 9` limit per segment.

## Design

Four reinforcement layers applied together:

### Layer 1: Strengthen Image1 (last frame) description

**File:** `src/pipeline/stages/3-prompts.ts` — `buildReferenceDescription`

Current Image1 description (weak):
```
[Image1] is the last frame of the previous clip — use as visual anchor for seamless continuity in the opening frames.
```

Enhanced (strong):
```
[Image1] is the EXACT last frame of the previous clip. Your opening frames MUST match this image — same background, same lighting, same color palette, same character positions, same camera angle. This is the highest-priority reference.
```

**File:** `src/pipeline/stages/3-prompts.ts` — `buildRules`

Add a hard rule for segments after the first:
```
The first 2 seconds of this clip must be visually continuous with [Image1] — match the background, lighting, color temperature, and character positions exactly.
```

### Layer 2: Add previous act's storyboard row-3 as environment reference

**File:** `src/pipeline/stages/3-prompts.ts` — `assembleReferenceImages`, `buildReferenceDescription`

For segment N (N > 1), inject the previous act's last storyboard row strip (`act-{prev}-row-3.png`) as the second reference image, after the last frame.

Reference image ordering becomes:
```
Image1: Previous segment's last frame (visual anchor)
Image2: Previous act's row-3 strip (environment context)
Image3-5: Current act's row-1/2/3 strips (composition guide)
Image6-8: Character reference images
```

Image2 description:
```
[Image2] is the storyboard strip for the ENDING of the previous act — use to maintain environment consistency (walls, furniture, lighting direction).
```

When `act-{prev}-row-3.png` does not exist (first segment or missing file), skip this slot.

### Layer 3: Enhanced continuityNote with visual specificity

**File:** `src/pipeline/stages/3-prompts.ts` — `buildContinuityNote`

Replace the generic continuity note with scene-aware detailed instructions.

**Same scene** (`firstShot.scene === prevLastShot.scene`):
```
VISUAL CONTINUITY — SAME SCENE:
[Image1] shows exactly where the previous clip ended. Your opening frames must match:
• Background: identical walls, furniture, objects, spatial layout
• Lighting: same direction, intensity, and color temperature
• Camera: same angle and distance from subjects
• Characters: same positions and poses as shown in [Image1]
Action continues from: {prevLastShot.action}
```

**Different scene**:
```
VISUAL CONTINUITY — SCENE TRANSITION:
[Image1] shows the previous clip's ending. Transition smoothly to the new scene while:
• Maintaining consistent character appearance and costume
• Using a natural transition (the character walks/turns to reveal the new environment)
Action continues from: {prevLastShot.action}
```

When no previous last frame exists (first run, first segment), fall back to the current text-only format.

### Layer 4: Stage 4 enhanced injection

**File:** `src/pipeline/stages/4-video-gen.ts`

After generating segment N and extracting its last frame, update segment N+1's prompt JSON with all four layers:

1. **referenceImageRefs**: prepend `[lastFramePath, prevRow3Path, ...existingRefs]`
2. **referenceDesc**: prepend enhanced Image1 + Image2 descriptions, shift existing `[ImageN]` indices
3. **continuityNote**: replace with the enhanced scene-aware version (requires reading the next segment's shot data to determine same-scene vs cross-scene)
4. **rules**: append the "first 2 seconds must match Image1" hard rule
5. **Rebuild prompt** via `buildSeedancePrompt(updatedConfig)` and save to disk

This ensures that even on the first pipeline run (where last frames don't exist during stage 3), stage 4's sequential processing injects the visual anchors before generating each subsequent segment.

## Files Changed

| File | Changes |
|------|---------|
| `src/pipeline/stages/3-prompts.ts` | Layers 1-3: enhanced referenceDesc, additional row-3 ref, enhanced continuityNote, hard rule |
| `src/pipeline/stages/4-video-gen.ts` | Layer 4: enhanced injection with all four layers |

## Verification

1. Run full pipeline on a 4-act same-scene short film
2. Inspect `prompts/segment-2.json` after stage 3 to verify: enhanced referenceDesc, row-3 in refs, enhanced continuityNote, hard rule in rules
3. Inspect `prompts/segment-2.json` after stage 4 to verify: last frame and row-3 injected into referenceImageRefs
4. Compare generated video clips for visual continuity at act boundaries
