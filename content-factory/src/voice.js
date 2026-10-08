// Bobo's voice: Gemini text-to-speech, one line at a time so the captions can
// follow the voice exactly.

export const DEFAULT_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
export const DEFAULT_VOICE = 'Orus'; // a firm, warm male voice

const STYLE = 'Read this as a warm, confident motivational speaker talking to one friend: clear standard English, natural pace, real emotion, short pauses at commas. Say only the words:';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rateFrom(mime) {
  const m = String(mime || '').match(/rate=(\d+)/);
  return m ? Number(m[1]) : 24000;
}

// Strips the on-screen *highlight* marks before speaking.
export const spoken = (line) => line.replace(/\*/g, '');

export async function speak({ ai, text, voice = DEFAULT_VOICE, models = DEFAULT_TTS_MODELS, retries = 4, wait = sleep }) {
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ parts: [{ text: `${STYLE}\n${spoken(text)}` }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!part) throw new Error('No audio came back.');
        let pcm = Buffer.from(part.inlineData.data, 'base64');
        // Some models wrap the audio in a WAV header; keep only the samples.
        if (pcm.subarray(0, 4).toString() === 'RIFF') pcm = pcm.subarray(44);
        return { pcm, rate: rateFrom(part.inlineData.mimeType), model };
      } catch (err) {
        lastErr = err;
        if (err?.status === 404 || err?.status === 400) break; // this model isn't available; try the next one
        if (err?.status === 429 || err?.status >= 500) { await wait(15_000 * (attempt + 1)); continue; } // free-tier limit or busy
        break;
      }
    }
  }
  throw new Error(`Couldn't make the voice: ${lastErr?.message || lastErr}`);
}
