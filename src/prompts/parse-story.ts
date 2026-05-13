/**
 * Build the LLM message array for parsing a story into a structured film config.
 * The LLM is instructed to output JSON matching the ParsedFilmConfig type.
 */

const SYSTEM_PROMPT = `You are an expert film producer and story analyst. Your job is to read a raw story text and extract structured metadata that can be used to configure an automated AI video production pipeline.

You MUST output valid JSON matching this schema (no markdown fences, no commentary — only the JSON object):

{
  "title": string,               // inferred film title from the story
  "story": string,               // original story text verbatim — do NOT rewrite or summarize
  "characters": [
    {
      "name": string,
      "description": string      // detailed appearance and personality — suitable for image generation
    }
  ],
  "scenes": [
    {
      "id": string,              // kebab-case location identifier, e.g. "park-ext-sunset", "micro-world-cyber"
      "description": string      // brief description of the location and its visual atmosphere
    }
  ],
  "duration": 60 | 90 | 120,    // inferred from story density, hard cap at 60
  "style": "cinematic" | "anime" | "3d-pixar",
  "resolution": "720p",
  "aspectRatio": "16:9",
  "seed": number                 // random integer between 1000 and 9999
}

INFERENCE RULES:

1. DURATION: Infer from the number of story paragraphs and action density. Hard upper limit is 60 seconds. Use 60 for stories with 3+ distinct scenes or complex action; use 90 or 120 only if not yet at the cap (they won't apply given the hard cap of 60).

2. STYLE:
   - "cinematic" — realistic human drama, live-action feel, serious tone
   - "anime" — manga/anime aesthetic, Japanese animation style, 2D look
   - "3d-pixar" — cartoonish, colorful, child-friendly, Pixar-like 3D animation

3. CHARACTERS: Identify all named or clearly implied characters. Each description must be detailed enough for standalone image generation — include:
   - Age and body type
   - Hair: color, style, length, texture (use precise color words)
   - Face: shape and distinctive features
   - Clothing: exact garments, colors, materials, accessories
   - Distinguishing marks if any

4. SCENES: Identify all distinct locations or settings. Use kebab-case IDs that encode location, interior/exterior, and time of day where applicable (e.g. "forest-ext-dawn", "office-int-night", "rooftop-ext-dusk").

5. SEED: Output a random integer between 1000 and 9999.`;

export function buildParseStoryPrompt(
  storyText: string,
): Array<{ role: "system" | "user"; content: string }> {
  const userPrompt = `Parse the following story and extract the structured film configuration as JSON:

STORY:
${storyText}

Output only the JSON object. No markdown fences, no explanation.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}
