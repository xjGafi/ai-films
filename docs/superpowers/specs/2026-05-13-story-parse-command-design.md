# Design: `parse` Command — Story Text → film.json

**Date:** 2026-05-13
**Status:** Approved

## Overview

Add a `parse` CLI subcommand that accepts a story text file, uses an LLM to extract
characters, scenes, duration, and style, writes a ready-to-use `film.json`, and
optionally chains into `create` + `run` for a fully automated pipeline invocation.

## Command Interface

```
ai-film parse <story-file> [options]

Options:
  --output <path>   Output path for film.json (default: ./film.json)
  --run             After writing film.json, auto-execute create + run
  --dry-run         Print extracted config to stdout only; no file write, no run
```

`--run` and `--dry-run` are mutually exclusive.

### Typical usage

```bash
# Extract and inspect before committing
ai-film parse story.txt --output film.json

# One-shot: story text → final video
ai-film parse story.txt --run
```

## LLM Extraction

### New file: `src/prompts/parse-story.ts`

Builds the LLM message array for story parsing. The model outputs a JSON object
matching `ParsedFilmConfig` (no markdown, no commentary).

**Extracted fields and rules:**

| Field | Rule |
|---|---|
| `title` | Short film title inferred from the story |
| `story` | Original story text verbatim (no rewriting) |
| `characters[]` | All named characters with physical appearance descriptions |
| `scenes[]` | All distinct locations; `id` in kebab-case (e.g. `park-ext-sunset`) |
| `duration` | 60, 90, or 120 — inferred from story density; hard cap at 60 |
| `style` | `cinematic` for live-action drama; `anime` for animated/2D; `3d-pixar` for cartoon |
| `resolution` | Always `"720p"` (fixed default) |
| `aspectRatio` | Always `"16:9"` (fixed default) |
| `seed` | Random integer generated at parse time |

**Style inference heuristic (in system prompt):**
- Realistic human drama / documentary feel → `cinematic`
- Anime aesthetic, stylized Japanese animation → `anime`
- Cartoon, children's content, Pixar-like → `3d-pixar`

### Output type: `ParsedFilmConfig`

```typescript
interface ParsedFilmConfig {
  title: string;
  story: string;
  characters: { name: string; description: string }[];
  scenes: { id: string; description: string }[];
  duration: 60 | 90 | 120;
  style: "cinematic" | "anime" | "3d-pixar";
  resolution: "720p";
  aspectRatio: "16:9";
  seed: number;
}
```

This maps directly to `ProjectConfig` after dropping `title` and converting
`scenes` to `SceneInput[]` (adding an optional `description` field — see Types section).

## New file: `src/pipeline/parse.ts`

Exports `parseStory(storyText: string): Promise<ParsedFilmConfig>`.

Data flow:
```
storyText
  ↓ buildParseStoryPrompt(storyText)
  ↓ callTextAPI() — JSON mode, same model as Stage 0 (doubao-1-5-pro-32k-250115)
  ↓ JSON.parse + validate required fields
ParsedFilmConfig
```

Validation: throw with a clear message if required fields (`characters`, `scenes`,
`duration`, `style`) are missing or malformed.

## CLI changes: `src/cli.ts`

New `parse` command wired to:
1. Read story file from disk (`fs.readFileSync`)
2. Call `parseStory(storyText)`
3. If `--dry-run`: print JSON to stdout, exit
4. Write `ParsedFilmConfig` → `film.json` at `--output` path (converting to `ProjectConfig` shape)
5. If `--run`: call `createProject()` then `runPipeline()`, print projectId and progress

## Types change: `src/types.ts`

Add optional `description` field to `SceneInput`:

```typescript
export interface SceneInput {
  id: string;
  description?: string;  // NEW — scene environment description from parse step
  imagePath?: string;
}
```

Stage 1 (`1-characters.ts`) already calls `buildSceneRefPrompt(scene, style)` for
scenes without a provided image. The `buildSceneRefPrompt` function currently uses
`scene.sceneDescription` from `SceneSpec` (the screenplay output). The
`SceneInput.description` from the config can serve as a pre-hint but Stage 0 will
generate its own `SceneSpec.sceneDescription` anyway — the field is available for
future use without blocking the pipeline.

## Responsibility Boundary

| File | Responsibility |
|---|---|
| `parse-story.ts` | Extract metadata (characters, scenes, duration, style) from raw story text |
| `screenplay.ts` | Generate full shot-by-shot screenplay structure from story + config |

These do not overlap. `parse-story.ts` runs before project creation; `screenplay.ts`
runs as Stage 0 inside the pipeline.

## Error Handling

- Story file not found → clear error message, exit 1
- LLM returns invalid JSON → retry once, then throw with raw response in message
- `--run` and `--dry-run` both set → error before any LLM call
- `--output` path directory does not exist → create it with `mkdirSync({ recursive: true })`

## Files Changed

| File | Change |
|---|---|
| `src/prompts/parse-story.ts` | New — LLM prompt builder |
| `src/pipeline/parse.ts` | New — `parseStory()` orchestration |
| `src/cli.ts` | Modified — add `parse` subcommand |
| `src/types.ts` | Modified — add `SceneInput.description?: string` |
