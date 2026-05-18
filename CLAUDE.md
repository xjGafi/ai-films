# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm run dev` — run CLI via tsx (no build step needed)
- `pnpm run build` — compile TypeScript to dist/
- `pnpm run typecheck` — type-check without emitting
- `pnpm run lint` — check formatting and lint rules via Biome
- `pnpm run format` — auto-fix formatting and lint issues via Biome

Package manager is pnpm (not npm).

## Required Setup

- `VOLC_API_KEY` env var must be set before running the pipeline
- `ffmpeg` and `ffprobe` must be on system PATH (used by fluent-ffmpeg for frame extraction and concatenation)

## Architecture

CLI tool that generates AI short films through a 7-stage pipeline. Stages run in strict sequential order and are numbered `0-` through `6-` in `src/pipeline/stages/`:

0. screenplay — LLM generates structured screenplay JSON
1. characters — generate/copy character reference images
2. storyboard — generate 4x3 grid storyboard, crop panels with sharp
3. prompts — build Seedance 2.0 video prompts per segment
4. video-gen — call Volcengine video API, download clips
5. transitions — build assembly plan with transition strategies
6. assembly — concatenate clips via ffmpeg

All Volcengine API calls go through a proxy at `https://ai-apis.medomino.com/proxy/volcengine`, using the OpenAI SDK as client with a custom `baseURL`.

Project state is persisted to `projects/<uuid>/state.json` relative to cwd — the CLI must be run from the repo root.

## Code Conventions

- ESM modules — imports use `.js` extensions (`import { x } from "./foo.js"`)
- TypeScript strict mode
- Named exports only (no default exports)
- Stage files prefixed with numeric sort order
- 2-space indent in generated/persisted JSON

## Git Workflow

Feature branches (`feat/xxx`, `fix/xxx`) with squash-merge to main.

## Known Issues

- ModeA/ModeB image references in `4-video-gen.ts` pass local file paths where the API expects URLs — upload mechanism not yet implemented
- The `regen --clip` option does not respect the clip index; it always re-runs from video-gen stage

## 工作规范
- 所有注释用中文，变量函数用英文。
- 改动前先说明你打算改什么，确认后再动手。
- 新功能先写实现，不主动加测试，除非我明确要求。
- 数据库表名用下划线分隔，比如 user_profile。
- git 提交 message 使用中文

## 禁止项
- 不要主动重构我没提到的文件。
- 不要删除任何文件，除非我明确说删掉。
- 不要在没确认前直接执行 pnpm install 装新依赖。

## 压缩时保留
长对话被自动压缩时，按优先级保留：
1. 架构决策和它背后的理由
2. 改过哪些文件、改了什么
3. 当前进展状态
4. 还没做完的 TODO