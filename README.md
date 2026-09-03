# ai-films

**Turn a short story into a complete 1–2 minute AI film — automatically.**

`ai-films` is a TypeScript CLI pipeline that generates AI short films end to end: from story to screenplay, characters, storyboard, video clips, transitions, and final assembly. It is built on the Volcengine model family (Doubao for text, Seedream for images, Seedance 2.0 for video) through an OpenAI-compatible API layer.

## Highlights

- 🎬 **End-to-end pipeline** — 7 stages from a raw story to a final MP4, no manual steps in between.
- 📝 **Structured screenplay** — an LLM turns your story into a structured film config (scenes, shots, characters).
- 👤 **Character consistency** — reference images (front + 3/4 views) keep the same characters consistent across every shot.
- 🗣️ **Dialogue & audio** — per-shot lines are injected into the video prompts, and audio generation is enabled by default.
- 🔁 **Resumable & inspectable** — every stage persists state, so you can resume from any stage and track progress per stage.
- 🔌 **Provider-agnostic design** — all model calls go through the official OpenAI SDK against an OpenAI-compatible gateway, so swapping model backends is a config change, not a rewrite.
- 🧩 **Deterministic controls** — duration (60/90/120s), style (`cinematic` | `anime` | `3d-pixar`), resolution, and seed.

## How it works

| # | Stage | What it does |
|---|-------|--------------|
| 0 | `screenplay` | LLM generates a structured screenplay from your story |
| 1 | `characters` | Generates/copies character reference images |
| 2 | `storyboard` | Generates a 4×3 storyboard grid, crops panels with sharp |
| 3 | `prompts` | Builds Seedance 2.0 video prompts per segment |
| 4 | `video-gen` | Submits video tasks, polls asynchronously, downloads clips |
| 5 | `transitions` | Builds the assembly plan with transition strategies |
| 6 | `assembly` | Concatenates clips into the final film with ffmpeg |

Video generation is asynchronous: submit a task → poll until it succeeds → download the clip. The final film is written to `projects/<project-id>/output/final.mp4`.

## Requirements

- Node.js 18+ (developed on Node 22)
- pnpm
- `ffmpeg` and `ffprobe` on your `PATH`
- A Volcengine API key

## Setup

```bash
git clone https://github.com/xjGafi/ai-films.git
cd ai-films
pnpm install
```

Create a `.env` file in the repo root:

```bash
VOLC_API_KEY=your-volcengine-api-key
```

All model calls go through the OpenAI-compatible gateway configured in `src/config.ts` — no other account setup is required.

> Run the CLI from the repo root: project state is persisted under `projects/<uuid>/` relative to the current working directory.

## Usage

```bash
# 1. Create a project from a short story, with optional character reference images
pnpm dev create -s "A little girl finds a glowing lantern in the snow..." \
  -c "Mira:./characters/mira.png" \
  -d 60 --style cinematic --resolution 720p

# 2. Run the full pipeline
pnpm dev run <project-id>

# 3. Check progress
pnpm dev status <project-id>
pnpm dev list
```

Alternatively, drive everything from a JSON config file:

```bash
pnpm dev create --config film.json
```

You can also parse a plain-text story into a `film.json` config and run it in one step:

```bash
pnpm dev parse story.txt --output film.json --run
```

## CLI reference

| Command | Description |
|---|---|
| `create` | Create a new project. Options: `--story/-s`, `--character/-c <name:path>` (repeatable), `--duration/-d <60\|90\|120>`, `--style <cinematic\|anime\|3d-pixar>`, `--resolution <720p\|1080p>`, `--seed <n>`, `--config <path>` |
| `run <id>` | Run the pipeline for a project. Options: `--from <stage>`, `--to <stage>`, `--clean` |
| `status <id>` | Show per-stage status, artifacts, and errors |
| `list` | List all projects with progress |
| `clean <id>` | Clear intermediate files and reset stages from `video-gen` onward |
| `regen <id> --clip <N>` | Regenerate a clip |
| `parse <file>` | Parse a story file into a `film.json` config. Options: `--output <path>`, `--run`, `--dry-run` |

## Project structure

```
src/
├── cli.ts                  # CLI entry (commander)
├── config.ts               # API gateway, models, defaults
├── project.ts              # Project creation / discovery
├── pipeline/
│   ├── runner.ts           # Stage scheduler (sequential + resume)
│   ├── state.ts            # JSON state persistence (state.json)
│   ├── parse.ts            # Story → film.json parsing
│   └── stages/             # 0-screenplay … 6-assembly
├── providers/
│   ├── volcengine.ts       # Unified Volcengine API wrapper (chat / image / video)
│   └── ffmpeg.ts           # ffmpeg / ffprobe helpers
├── prompts/                # LLM prompt templates
└── types.ts                # Shared types + stage names
projects/<uuid>/            # Runtime state: state.json, clips/, frames/, output/
docs/                       # Architecture & API docs (in Chinese)
scripts/                    # Utility scripts (e.g. resume-video.ts)
```

## Development

```bash
pnpm dev         # run the CLI via tsx (no build step)
pnpm build       # compile TypeScript to dist/
pnpm typecheck   # type-check without emitting
pnpm lint        # lint via Biome
pnpm format      # auto-fix formatting and lint issues
pnpm test        # run tests (vitest)
```

## Known limitations

- Some character reference modes in `4-video-gen` pass local file paths where the API expects URLs (an upload mechanism is not implemented yet).
- `regen --clip <N>` does not respect the clip index yet; it always re-runs from the `video-gen` stage.

## Documentation

Deeper design docs live in [`docs/`](docs/) (mostly in Chinese), including the product architecture design, the full API & pipeline guide, and the Seedance 2.0 parameter reference.
