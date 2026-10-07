// Optional ElevenLabs voice. Without a key, the stage page uses the browser's
// built-in voice instead.

const AUDIO_TTL_MS = 5 * 60_000;

export function createTts({ apiKey, voiceId, modelId = 'eleven_flash_v2_5', fetchImpl = fetch } = {}) {
  const clips = new Map(); // id -> { buf, expires }
  let n = 0;

  function sweep(now = Date.now()) {
    for (const [id, c] of clips) if (c.expires < now) clips.delete(id);
  }

  return {
    enabled: Boolean(apiKey && voiceId),

    // Returns the URL the stage page should play, or null to use the browser voice.
    async speak(text) {
      if (!this.enabled) return null;
      const res = await fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: modelId }),
        },
      );
      if (!res.ok) throw new Error(`ElevenLabs voice error ${res.status}`);
      sweep();
      const id = `${Date.now().toString(36)}-${++n}`;
      clips.set(id, { buf: Buffer.from(await res.arrayBuffer()), expires: Date.now() + AUDIO_TTL_MS });
      return `/audio/${id}.mp3`;
    },

    get(id) {
      return clips.get(id)?.buf ?? null;
    },
  };
}
