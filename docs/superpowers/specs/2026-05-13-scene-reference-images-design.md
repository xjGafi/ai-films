# Scene Reference Images — Visual Consistency from the Source

## Problem

Each act's storyboard and video are generated independently with no shared visual reference for the environment. Even when all acts take place in the same scene (e.g., "lab-int-day"), the AI generates different-looking rooms — different walls, furniture, lighting — because the only input is text description. This is the upstream root cause of cross-act visual discontinuity.

Character reference images exist and flow into video generation, but there is no equivalent for scenes/environments.

## Solution

Generate scene reference images alongside character reference images in Stage 1. These "empty environment" images serve as visual anchors for the scene's spatial layout, materials, lighting, and color palette. They flow into Stage 3 (prompts) and Stage 4 (video-gen) as part of `reference_images`, ensuring every act set in the same scene references the same visual environment.

## Constraints

- The Doubao image generation API (`generateImage`) may not support `reference_images` — scene refs are generated from text prompts only.
- Stage 2 (storyboard) is not modified in this iteration (pending confirmation of image API reference support).
- `MAX_REFERENCE_IMAGES = 9` limit per segment must be respected.
- Scene images are empty environments — no characters.

## Design

### New Type: `SceneSpec`

```typescript
export interface SceneSpec {
  id: string;              // "lab-int-day"
  name: string;            // "现代实验室"
  sceneDescription: string; // detailed physical environment description
}
```

Add `scenes: SceneSpec[]` to the `Screenplay` interface.

### Stage 0: Screenplay Generation

Modify the screenplay prompt (`src/prompts/screenplay.ts`) to require the LLM to output a `scenes` array in `screenplay.json`. Each scene must include:

- `id`: a kebab-case identifier matching the `scene` field used in `ShotSpec` (e.g., `"lab-int-day"`)
- `name`: human-readable name (e.g., `"现代实验室"`)
- `sceneDescription`: detailed physical environment description covering:
  - Spatial layout (room shape, size, open/enclosed)
  - Wall/floor/ceiling materials and colors
  - Furniture and prop placement
  - Lighting direction, intensity, and color temperature
  - Overall color palette and mood

Add validation in `0-screenplay.ts` to verify:
- `scenes` array exists and is non-empty
- Every `shot.scene` value in every act maps to a scene in the `scenes` array

### Stage 1: Character + Scene Reference Generation

Extend `1-characters.ts` to generate scene reference images after character images:

1. Create `{projectDir}/scenes/` directory.
2. For each `SceneSpec` in `screenplay.scenes`:
   - Check if user provided a scene image via `state.config.scenes[].imagePath` (same pattern as character images).
   - If provided and file exists, copy it to `scenes/{scene.id}-ref.png`.
   - Otherwise, build a scene prompt using `scene.sceneDescription` + project style, and call `generateImage()`.
   - Save as `scenes/{scene.id}-ref.png`.
3. Store a `sceneRefMap: Map<string, string>` (scene ID → file path) for downstream use.

**Scene prompt structure** (new file `src/prompts/scene-ref.ts`):
```
Empty environment reference image.

{scene.sceneDescription}

REQUIREMENTS:
- No people, no characters, no figures of any kind.
- Show the environment as an establishing shot — wide angle, full spatial context.
- Consistent with the following visual style: {styleBlock}
- Aspect ratio: 16:9

Do not add text overlays, watermarks, or labels.
```

### Stage 3: Prompts — Scene Image in Reference Images

Modify `3-prompts.ts`:

1. Build a `sceneRefMap` from `{projectDir}/scenes/` directory (scene ID → file path).
2. For each act, determine the act's primary scene: the most common `shot.scene` value across the act's shots.
3. In `assembleReferenceImages`, insert the scene reference image after `prevRow3Path` and before current act's storyboard rows:

```
Image priority order:
1. Previous segment's last frame (if exists)
2. Previous act's row-3 strip (if exists)
3. Current scene reference image (NEW)
4. Current act's row-1, row-2, row-3 strips
5. Character reference images
```

4. In `buildReferenceDescription`, add a description for the scene image:
```
[ImageN] is the reference environment for scene "{scene.name}" — match this exact room layout, wall colors, lighting, and spatial arrangement throughout all shots.
```

### Stage 4: Video Generation — Scene Image Injection

Modify the injection block in `4-video-gen.ts`:

When injecting continuity layers into the next segment's prompt, also check if the next segment's scene has a scene reference image. If it does and it's not already in `referenceImageRefs`, include it in the prepended references (after last frame and prev row-3, before existing refs).

## Files Changed

| File | Changes |
|------|---------|
| `src/types.ts` | Add `SceneSpec` interface, add `scenes` to `Screenplay` |
| `src/prompts/screenplay.ts` | Add scenes requirement to LLM prompt |
| `src/pipeline/stages/0-screenplay.ts` | Add scenes validation |
| `src/prompts/scene-ref.ts` | New file: scene reference image prompt builder |
| `src/pipeline/stages/1-characters.ts` | Add scene image generation loop |
| `src/pipeline/stages/3-prompts.ts` | Add scene ref to referenceImageRefs and referenceDesc |
| `src/pipeline/stages/4-video-gen.ts` | Add scene ref to injection logic |

## Reference Image Budget

With scene images added, a typical segment's reference_images for a same-scene continuation:

```
1. Previous last frame
2. Previous act's row-3
3. Scene reference image
4. Current act's row-1
5. Current act's row-2
6. Current act's row-3
7. Character ref 1
8. Character ref 2
= 8 images (within the 9-image limit)
```

For 3+ characters, the last character ref may be dropped. This is acceptable — character consistency is reinforced by the storyboard rows which contain character depictions.

## Verification

1. Run Stage 0 on a test film config and verify `screenplay.json` contains `scenes` array
2. Run Stage 1 and verify `scenes/{id}-ref.png` files are generated
3. Run Stage 3 and inspect `segment-{N}.json` to verify scene ref in `referenceImageRefs` and described in `referenceDesc`
4. Run full pipeline and compare visual consistency across acts
