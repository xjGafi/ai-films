import type { CharacterInput, SceneInput } from "../types.js";

/**
 * Build the LLM message array for structured screenplay generation.
 * The LLM is instructed to output JSON matching the Screenplay type.
 */

const SYSTEM_PROMPT = `You are an expert film screenwriter and storyboard architect. Your job is to turn a story description into a structured screenplay that can be directly used by an automated AI video production pipeline.

You MUST output valid JSON matching this schema (no markdown fences, no commentary — only the JSON object):

{
  "title": string,
  "totalDuration": number,
  "characters": [
    {
      "id": string,   // e.g. "character-1", "character-2" — use this exact format
      "name": string,
      "detail": string  // FULL physical description for reuse in image/video prompts
    }
  ],
  "scenes": [
    {
      "id": string,          // e.g. "scene-1", "scene-2" — use this exact format; must exactly match the FIXED SCENES ids if provided
      "name": string,        // short readable name
      "description": string, // brief description
      "detail": string       // detailed physical environment description (see requirement 10)
    }
  ],
  "acts": [
    {
      "act": number,             // 1, 2, 3 …
      "name": string,            // e.g. "Setup", "Confrontation", "Resolution"
      "durationTarget": number,  // target seconds for this act
      "emotionalArc": string,    // e.g. "calm → tense"
      "shots": [
        {
          "id": number,
          "type": string,            // shot type abbreviation: ECU, CU, MCU, MS, MWS, WS, EWS, OTS, POV, Low, High, Bird, Dutch
          "camera": string,          // camera movement: "tracking", "static", "pan left", "push in", etc.
          "title": string,           // short shot label, e.g. "The Setup"
          "action": string,          // detailed action description — be specific and visual
          "emotion": string,         // e.g. "tense", "joyful", "melancholy"
          "physics": string,         // optional physics tag: "Rigid body collisions", "Fluid movement", etc.
          "pace": string,            // "slow" | "medium" | "fast" — controls shot duration weight
          "actionContinuous": boolean, // true if action flows directly from previous shot
          "scene": string            // scene id for transition logic, e.g. "scene-1", "scene-2"
        }
      ]
    }
  ],
  "transitionHints": [
    {
      "afterShot": number,           // shot ID after which the transition occurs
      "strategy": string             // "first_frame_anchor" | "occlusion_transition" | "continuity_crossfade" | "hard_cut"
    }
  ]
}

KEY REQUIREMENTS:

1. SHOTS PER ACT: Each act MUST contain EXACTLY 9 shots — no more, no fewer. This is a hard requirement for the storyboard pipeline (9 shots = 3×3 grid). Do NOT include a "time" field — timestamps are computed automatically from the "pace" values. Focus on shot content and pacing.

2. TOTAL DURATION: The total number of acts is given in the user message — generate exactly that many acts, each with a durationTarget of 15 seconds. The sum of all act durationTargets must equal the requested total duration.

3. TRANSITION HINTS: Insert a transition hint at the last shot of each act except the final one (every 9 shots = every 15 seconds). Choose the strategy based on the narrative context at the act boundary:
   - "first_frame_anchor" — same scene, continuous action crossing the act cut (chases, fights)
   - "occlusion_transition" — scene change (use physical occlusion to mask the cut)
   - "continuity_crossfade" — same scene, different action (default, 0.3s crossfade)
   - "hard_cut" — montage, fast pace, deliberate jump

4. SHOT TYPES: Use standard film abbreviations:
   ECU (Extreme Close-Up), CU (Close-Up), MCU (Medium Close-Up), MS (Medium Shot),
   MWS (Medium Wide Shot), WS (Wide Shot), EWS (Extreme Wide Shot),
   OTS (Over-the-Shoulder), POV (Point of View),
   Low (Low Angle), High (High Angle), Bird (Bird's Eye), Dutch (Dutch Angle)

5. CHARACTER DESCRIPTIONS: Each character MUST have a "detail" field containing a complete, precise physical description suitable for reuse in image and video generation prompts. Include:
   - Age, body type, height impression
   - Hair: color, style, length, texture (use precise color words like "charcoal grey", not "dark")
   - Face: shape, distinctive features, expression style
   - Clothing: exact garments, colors, materials, accessories
   - Distinguishing marks: scars, tattoos, jewelry
   Do NOT use vague references like "same as before" — each description must be self-contained.

6. ACTION DESCRIPTIONS: Be specific and visual. Describe what the camera SEES, not abstract narrative. Include:
   - Character positions and movements
   - Physical interactions with environment
   - Emotional expressions visible on screen
   - Any relevant props or objects
   - FIRST APPEARANCE LABEL: When a character appears for the first time in a shot, append their id in parentheses after their name: e.g. "老王 (character-1) sits on the bench" or "insulin搬运工小人 (character-2) carry the key". This label helps downstream processing identify which characters appear in each segment.

7. SHOT PACING: The "pace" field controls both editing rhythm AND shot duration. The pipeline uses pace to compute precise timestamps, so choose carefully:
   - slow: long lingering shot, contemplative movement, landscape, emotion (gets more screen time)
   - medium: standard cadence, narrative scenes, dialogue (default weight)
   - fast: short sharp shot, action, impact, rapid cuts (gets less screen time)
   The 9 shots' pace values together determine how the act's 15 seconds are distributed.

8. CAMERA LANGUAGE: Use precise camera direction terms:
   - Movement: tracking, dolly, pan (left/right), tilt (up/down), push-in, pull-out, crane, handheld, static, zoom
   - Qualifiers: smooth, rapid, slow, gentle, violent, circling, orbiting

9. SCENE IDENTIFIERS: Use semantic ids for scenes in the format "scene-1", "scene-2", "scene-3" etc. Use "character-1", "character-2" etc. for character ids. If FIXED SCENES or FIXED CHARACTERS are provided, use their exact ids as given — do not rename.

10. SCENE DESCRIPTIONS: For every unique location that appears in the shots, add one entry to the "scenes" array. The "id" must use the format "scene-1", "scene-2"... matching the FIXED SCENES ids if provided, and must exactly match the "scene" field values used in the shot objects. Each "detail" must cover:
   - Spatial layout: room shape, size, open/enclosed feel
   - Wall/floor/ceiling: materials, colors, textures
   - Furniture and prop placement
   - Lighting: direction, intensity, color temperature, mood
   - Overall color palette
   Be specific enough that an image generator can reproduce the exact same room twice.

CRITICAL: Never use ASCII double-quote characters ( " ) inside any JSON string value — they will break JSON parsing. Use Chinese quotation marks (「」or 『』) or single quotes (') inside string values instead.

11. NO FILLER SHOTS: Never pad an act with empty visual beats such as fade-to-black, title cards, "screen goes dark", or repeated pull-out/zoom-out sequences. Every shot must contain meaningful narrative action or character performance. If the story's remaining content does not fill 9 shots, invent additional character reactions, environmental details, or visual metaphors that enrich the scene — do not resort to "the screen fades" or "the film ends".

12. CAMERA VARIETY: No more than 40% of shots within a single act may use "static" camera. Actively vary camera movements — use tracking, push-in, pull-out, pan, tilt, crane, dolly, handheld, etc. Match camera energy to the narrative: action scenes need dynamic movement, quiet scenes can be slower but still should not default to all-static.

13. PACE VARIATION: Each act MUST use at least 2 different pace values out of "slow", "medium", "fast". A uniform pace across all 9 shots kills rhythm. Build tension with fast cuts, release it with slow beats. Think in editing patterns: fast-fast-slow, medium-fast-medium, etc.

14. CHARACTER DESCRIPTIONS — NO SCENE PROPS: The "detail" field describes the character's permanent physical appearance only — body, face, hair, clothing, accessories they always wear. Do NOT include scene-specific props (food, drinks, weapons picked up during the story, etc.) as these will contaminate the character reference sheet. Props belong in shot "action" descriptions, not in character definitions.

15. CHARACTER DESCRIPTIONS — NO TEMPLATE LANGUAGE: Avoid generic, cliché appearance phrases like "五官精致" (delicate features), "眼神锐利" (sharp eyes), "鼻梁高挺" (high nose bridge). These are too vague for image generation. Instead, describe specific, distinctive visual traits: unusual color combinations, asymmetric features, visible textures, material contrasts on clothing, signature silhouette shapes. Each character should be visually distinguishable from any other character based on the description alone.

16. GROUP CHARACTERS: If a character represents a group of identical figures (e.g. "workers", "guards", "clones"), the "detail" field MUST start with "A group of identical [N]..." and describe their shared appearance as a collective unit. Do NOT write a singular description for a character that always appears as a group in the story. Example: "A group of identical 10cm tall tiny humanoid figures, each with short cropped white hair, round friendly cartoon faces, wears matching bright blue canvas work overalls..."

17. SCALE CHANGES: If a character appears at a non-standard size in any shot (miniaturized, enlarged, or at a scale significantly different from their baseline), the shot's "action" description MUST include a concrete size reference anchored to a visible object in the same frame. Example: "a miniaturized 8cm-tall version of 康小达@kkkk (character-3), no taller than the shirt collar beside them". Never use just "tiny" or "small" without an explicit measurement or comparison object.

18. SCENE TRANSITION SHOTS: When consecutive acts take place in different scenes, the FIRST shot of the new act must contain a narrative or psychological bridging element visible in frame — such as a character's reaction that references the previous scene, a visual echo or ghost image of the prior environment, or an environmental cue that motivates the location change. Never open a new-scene act with a cold shot that gives no reason for the location. Also: use "occlusion_transition" ONLY when a physical object (door, wall, crowd, passing vehicle) can plausibly occlude the cut within the shared physical space. For abstract location jumps (body interior → outdoors, dream → reality), use "hard_cut" instead.`;

export function buildScreenplayPrompt(
  story: string,
  characters: CharacterInput[],
  duration: number,
  style: string,
  scenes?: SceneInput[],
): Array<{ role: "system" | "user"; content: string }> {
  const characterList = characters
    .map((c) => {
      let line = `- ${c.name}`;
      if (c.detail)
        line += `\n  FIXED DESCRIPTION (use EXACTLY as-is in output, do not modify): ${c.detail}`;
      if (c.imagePath) line += ` (has reference image)`;
      return line;
    })
    .join("\n");

  const numActs = Math.ceil(duration / 15);

  let fixedScenesBlock = "";
  if (scenes && scenes.length > 0) {
    const sceneLines = scenes
      .map((s) => {
        const name = (s as { name?: string }).name ?? "";
        const detail = (s as { detail?: string }).detail ?? s.description ?? "";
        return `- [id: ${s.id}]${name ? ` [name: ${name}]` : ""} detail: ${detail}`;
      })
      .join("\n");
    fixedScenesBlock = `\nFIXED SCENES (use EXACTLY as-is — same id, same name, same detail — do not rename or rewrite):\n${sceneLines}\n\nAll shot "scene" fields must reference one of these exact ids (${scenes.map((s) => s.id).join(", ")}).\n`;
  }

  const userPrompt = `Generate a complete structured screenplay for the following film:

STORY:
${story}

CHARACTERS:
${characterList}
${fixedScenesBlock}
TARGET DURATION: ${duration} seconds
VISUAL STYLE: ${style}

Produce the JSON screenplay now. Remember:
- Each act MUST have EXACTLY 9 shots (no "time" field — timestamps are auto-computed from pace)
- Total number of acts: ${numActs} acts (${numActs} × 15s = ${numActs * 15}s)
- Include transitionHints at each act boundary (after the last shot of each act except the final)
- Character descriptions must be detailed enough for image generation prompts
- If a character already has a FIXED DESCRIPTION, copy it verbatim into detailedDescription — do not paraphrase or regenerate
- Action descriptions must be visual and camera-oriented
- Include a "scenes" array with one entry per unique location; id must use format "scene-1", "scene-2"... matching shot scene values
- If FIXED SCENES are provided, use their exact ids in both the "scenes" array and all shot "scene" fields`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}
