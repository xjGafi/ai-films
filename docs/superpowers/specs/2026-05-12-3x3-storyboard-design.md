# Design: 3×3 Storyboard + Per-Act Single 15s Clip

**Date:** 2026-05-12  
**Status:** Approved

---

## Problem

The current pipeline generates a 4×3 storyboard per act (12 shots), then crops each row into a separate Seedance call. This produces 3 × 15s clips per act (45s/act). The goal is to compress each act into a single 15s video to reduce API calls and align with the reference workflow from the Seedance 2.0 guide.

---

## Design

### Act structure

- Each act: **9 shots** arranged in a **3×3 storyboard grid** (3 columns × 3 rows)
- Each act maps to **1 Seedance call** → 1 × 15s clip
- Each shot: ~1.67s average duration
- Number of acts derived from config: `numActs = Math.ceil(duration / 15)`
  - `duration: 60` → 4 acts → 4 clips → 60s film
  - `duration: 90` → 6 acts → 6 clips → 90s film

### Storyboard generation (Stage 2)

`GRID_COLS = 3` (was 4). Everything else unchanged:
- Generate one 1920×1920 square grid image per act
- Crop 3 horizontal row strips (each 3 shots wide)
- Letterbox each strip onto a 1920×1080 canvas
- Artifacts: `storyboard/act-N-row-1.png`, `act-N-row-2.png`, `act-N-row-3.png`

### Prompt assembly (Stage 3)

One segment per act (was three). The segment receives all 9 shots and three row-strip reference images.

**`referenceImageRefs` order:**
```
[Image1]  act-N-row-1.png   shots 1–3, temporal window 0–5s
[Image2]  act-N-row-2.png   shots 4–6, temporal window 5–10s
[Image3]  act-N-row-3.png   shots 7–9, temporal window 10–15s
[Image4+] character ref images
```

**`referenceDesc` format:**
```
[Image1] is the storyboard row for Act N Row 1, showing shots 1–3 (0–5s) — use for composition and choreography.
[Image2] is the storyboard row for Act N Row 2, showing shots 4–6 (5–10s) — use for composition and choreography.
[Image3] is the storyboard row for Act N Row 3, showing shots 7–9 (10–15s) — use for composition and choreography.
[Image4] is CharacterName: <detailedDescription>
```

**SHOT SEQUENCE section** in the generated prompt uses row-level time headers:
```
[Row 1 — 0–5s]
Shot 1 (0:00-0:02) [MS] • tracking — Title
  Action description...

Shot 2 ...
Shot 3 ...

[Row 2 — 5–10s]
Shot 4 ...
...

[Row 3 — 10–15s]
Shot 7 ...
...
```

**`VideoPromptConfig` change:** add optional `shotsPerRow?: number` (defaults to `SHOTS_PER_ROW = 3`). The prompt builder uses this value to insert row headers every N shots.

### Screenplay validation (Stage 0)

- Validate `act.shots.length === 9` (was 12)
- `numActs` is communicated to the LLM via SYSTEM_PROMPT KEY REQUIREMENTS
- `transitionHints` inserted at **act boundaries only** (after shot 9, 18, 27 …), not at row boundaries within an act

### Transition hints

Row-level transitions within an act are no longer relevant (there is only one clip per act). The `transitionHints` array only needs entries between acts. Stage 3 continues to read them by `afterShot` ID as before — entries at intra-act row boundaries (shots 3, 6) will simply not appear in the new screenplay output.

---

## File change summary

| File | Change |
|------|--------|
| `src/pipeline/stages/0-screenplay.ts` | Validate `shots.length === 9`; derive `numActs` |
| `src/prompts/screenplay.ts` | Update KEY REQUIREMENTS: 9 shots, 3×3, ~1.67s/shot, 15s/act |
| `src/pipeline/stages/2-storyboard.ts` | `GRID_COLS = 3` |
| `src/pipeline/stages/3-prompts.ts` | `SHOTS_PER_ROW = 3`; one segment per act; pass 3 row images + char refs |
| `src/prompts/video-shot.ts` | Emit `[Row N — Xs–Ys]` headers in SHOT SEQUENCE; use `shotsPerRow` |
| `src/types.ts` | Add optional `shotsPerRow?: number` to `VideoPromptConfig` |

No changes to Stage 4 (video-gen), Stage 5 (transitions), or Stage 6 (assembly).

---

## Trade-offs accepted

- **1.67s per shot is short.** Seedance 2.0 must choreograph fast-cut sequences. The temporal row grouping (0-5s / 5-10s / 10-15s) gives the model sub-segment anchors to reduce drift. Acceptable for the target short-film format.
- **Fewer API calls.** 4 acts → 4 Seedance calls (vs. 12 previously for a 60s film). Faster and cheaper.
- **Loss of row-level re-generation granularity.** Previously a single bad row could be regenerated in isolation. Now the entire act must be re-run. Acceptable given the shorter overall clip count.
