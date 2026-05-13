import type { CharacterInput } from "../types.js";

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
      "id": string,          // e.g. "A", "B"
      "name": string,
      "detailedDescription": string  // FULL physical description for reuse in image/video prompts
    }
  ],
  "scenes": [
    {
      "id": string,              // kebab-case identifier matching shot "scene" values, e.g. "lab-int-day"
      "name": string,            // human-readable name, e.g. "现代实验室"
      "sceneDescription": string // detailed physical environment description (see requirement 10)
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
          "scene": string            // scene identifier for transition logic, e.g. "desert-ext-day"
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

5. CHARACTER DESCRIPTIONS: Each character MUST have a "detailedDescription" field containing a complete, precise physical description suitable for reuse in image and video generation prompts. Include:
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

7. SHOT PACING: The "pace" field controls both editing rhythm AND shot duration. The pipeline uses pace to compute precise timestamps, so choose carefully:
   - slow: long lingering shot, contemplative movement, landscape, emotion (gets more screen time)
   - medium: standard cadence, narrative scenes, dialogue (default weight)
   - fast: short sharp shot, action, impact, rapid cuts (gets less screen time)
   The 9 shots' pace values together determine how the act's 15 seconds are distributed.

8. CAMERA LANGUAGE: Use precise camera direction terms:
   - Movement: tracking, dolly, pan (left/right), tilt (up/down), push-in, pull-out, crane, handheld, static, zoom
   - Qualifiers: smooth, rapid, slow, gentle, violent, circling, orbiting

9. SCENE IDENTIFIERS: Use consistent scene identifiers (e.g. "desert-ext-day", "cave-int-night") so the pipeline can determine transition strategies between clips.

10. SCENE DESCRIPTIONS: For every unique location that appears in the shots, add one entry to the "scenes" array. The "id" must exactly match the "scene" field values used in the shot objects. Each "sceneDescription" must cover:
   - Spatial layout: room shape, size, open/enclosed feel
   - Wall/floor/ceiling: materials, colors, textures
   - Furniture and prop placement
   - Lighting: direction, intensity, color temperature, mood
   - Overall color palette
   Be specific enough that an image generator can reproduce the exact same room twice.`;

export function buildScreenplayPrompt(
  story: string,
  characters: CharacterInput[],
  duration: number,
  style: string,
): Array<{ role: "system" | "user"; content: string }> {
  const characterList = characters
    .map((c) => {
      let line = `- ${c.name}`;
      if (c.imagePath) line += ` (has reference image)`;
      return line;
    })
    .join("\n");

  const numActs = Math.ceil(duration / 15);

  const userPrompt = `Generate a complete structured screenplay for the following film:

STORY:
${story}

CHARACTERS:
${characterList}

TARGET DURATION: ${duration} seconds
VISUAL STYLE: ${style}

Produce the JSON screenplay now. Remember:
- Each act MUST have EXACTLY 9 shots (no "time" field — timestamps are auto-computed from pace)
- Total number of acts: ${numActs} acts (${numActs} × 15s = ${numActs * 15}s)
- Include transitionHints at each act boundary (after the last shot of each act except the final)
- Character descriptions must be detailed enough for image generation prompts
- Action descriptions must be visual and camera-oriented
- Include a "scenes" array with one entry per unique location; id must match shot scene values`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}
