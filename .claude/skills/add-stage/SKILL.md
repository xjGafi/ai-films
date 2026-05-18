---
name: add-stage
description: Scaffold a new numbered pipeline stage following the existing pattern in src/pipeline/stages/
---

You are adding a new stage to the AI film generation pipeline.

## Steps

1. Read the existing stages in `src/pipeline/stages/` to determine the next number (stages are `0-` through `6-`, so the next would be `7-`).
2. Read an existing stage file (e.g., `src/pipeline/stages/0-screenplay.ts`) to understand the pattern:
   - Each stage exports a single function named after the stage
   - The function takes `ProjectState` and returns `Promise<void>`
   - It reads from and writes to `ProjectState` fields
   - It uses providers from `src/providers/` for external API calls
3. Create the new stage file at `src/pipeline/stages/<N>-<name>.ts` following the same pattern.
4. Register the stage in `src/pipeline/runner.ts` by importing and adding it to the stages array.
5. Add any new state fields to `src/types.ts` and `src/pipeline/state.ts` if the stage needs to persist new data.
6. Run `npm run typecheck` to verify the new stage compiles correctly.

## Conventions

- Use named exports only (no default exports)
- ESM imports with `.js` extensions
- Keep the stage self-contained — external calls go through providers
- Use the Unicode section separator style (`// ─── Section ───`) for readability
