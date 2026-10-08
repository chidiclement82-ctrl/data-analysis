// Writes each video's script with Gemini: a scroll-stopping hook, a few short
// spoken lines (each with one *key* word that lights up on screen), and the
// TikTok post caption with hashtags.

export const FORMATS = [
  { id: 'hard-truth', brief: 'A hard truth people need to hear, said with love. Open with the uncomfortable truth, then show the way forward.' },
  { id: 'mini-story', brief: 'A tiny story (a farmer, a student, a trader, a runner...) in 3–4 lines with a twist, then the lesson in one line.' },
  { id: 'three-rules', brief: 'Three short rules for a better life on this topic, numbered "One...", "Two...", "Three...".' },
  { id: 'morning-push', brief: 'A morning wake-up message: energetic, direct, like a coach in your ear before the day starts.' },
  { id: 'night-reminder', brief: 'A calm late-night reminder for someone who feels behind or tired: gentle, warm, reassuring, but still pushing forward.' },
  { id: 'challenge', brief: 'A practical challenge for today that takes under 10 minutes, explained simply, ending with "Comment DONE when you finish."' },
];

export const TOPICS = [
  'discipline when motivation is gone', 'starting small', 'consistency beats talent', 'fear of failure',
  'comparing yourself to others', 'saving money and delayed gratification', 'learning a skill that pays',
  'waking up early', 'phone addiction and focus', 'choosing your friends', 'patience with your progress',
  'bouncing back after a loss', 'working while others sleep', 'believing in yourself when nobody does',
  'self-respect and boundaries', 'gratitude', 'taking care of your health', 'finishing what you start',
  'overthinking', 'the power of reading', 'being kind but not weak', 'building a business from nothing',
  'handling criticism', 'staying humble after success', 'turning pain into purpose', 'making your parents proud',
  'one more try', 'quiet hard work', 'time is your real money', 'protecting your peace',
];

// Varied, repeatable choices for a given day and slot (0, 1, 2).
export function planFor(date, slot) {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
  const n = day * 3 + slot;
  return {
    format: FORMATS[n % FORMATS.length],
    topic: TOPICS[(n * 7) % TOPICS.length], // step 7 so the same topic doesn't follow its neighbour
  };
}

const SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string', description: 'On-screen title, max 8 words, makes people stop scrolling.' },
    lines: {
      type: 'array', minItems: 4, maxItems: 8,
      items: { type: 'string', description: 'One spoken sentence, max 16 words, with exactly one *key* word in asterisks.' },
    },
    caption: { type: 'string', description: 'TikTok post caption, 1–2 sentences, ends with a question to drive comments.' },
    hashtags: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
  },
  required: ['hook', 'lines', 'caption', 'hashtags'],
  additionalProperties: false,
};

export function prompt({ format, topic }) {
  return `You write short motivational TikTok videos (25–40 seconds when spoken) for "Bobo", a warm, confident young man who talks like a caring big brother and coach. Clear, natural, standard English; easy for anyone to follow.

Today's video:
- Format: ${format.brief}
- Topic: ${topic}

Rules:
- The first spoken line must grab attention in under 2 seconds.
- 4 to 8 short lines, each one spoken sentence of at most 16 words. Simple words. No lists or emojis in the spoken lines.
- In every line, wrap exactly one important word in *asterisks*; it lights up on screen.
- Original wording: no famous quotes, no celebrity names, no medical or financial promises.
- End with a short line that makes people want to follow for tomorrow's push.
- The caption ends with a question that invites comments. Hashtags without the # sign, lowercase, relevant (e.g. motivation, discipline, selfimprovement).`;
}

export function clean(script) {
  const lines = (script.lines || [])
    .map((l) => String(l).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (lines.length < 3) throw new Error('The script came back too short.');
  return {
    hook: String(script.hook || '').replace(/\*/g, '').trim().slice(0, 80),
    lines,
    caption: String(script.caption || '').trim(),
    hashtags: (script.hashtags || []).map((h) => `#${String(h).replace(/^#/, '').replace(/\s+/g, '').toLowerCase()}`).filter((h) => h.length > 1).slice(0, 6),
  };
}

export async function writeScript({ ai, model, plan }) {
  const res = await ai.models.generateContent({
    model,
    contents: prompt(plan),
    config: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA, maxOutputTokens: 4096, temperature: 1 },
  });
  if (res.promptFeedback?.blockReason) throw new Error(`Script blocked: ${res.promptFeedback.blockReason}`);
  return clean(JSON.parse(res.text ?? '{}'));
}

// For dry runs without an API key.
export function sampleScript() {
  return clean({
    hook: 'Nobody is coming to save you',
    lines: [
      'Listen. Nobody is coming to *save* you.',
      'Not your friends, not luck, not next year.',
      'And that is the *best* news you will hear today.',
      'Because it means the power is in *your* hands.',
      'Do one small thing today that future you will thank you for.',
      'Follow me. Tomorrow, we *go* again.',
    ],
    caption: 'Your life changes the day you stop waiting. What is the one thing you will start today?',
    hashtags: ['motivation', 'discipline', 'selfimprovement', 'mindset'],
  });
}
