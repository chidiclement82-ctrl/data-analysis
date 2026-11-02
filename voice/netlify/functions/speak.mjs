// POST /api/speak — { voiceId, text } → { audio (base64 mp3), starts: [seconds per character] }
// The start times let the page highlight each word as your voice reads it.
import { ELEVEN, MODEL, guard, json, elevenHeaders, elevenError, VOICE_ID } from "../lib/eleven.mjs";

const MAX_TEXT = 2500;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const denied = await guard(req);
  if (denied) return denied;

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  const voiceId = String(body.voiceId || "");
  const text = String(body.text || "");
  if (!VOICE_ID.test(voiceId)) return json(400, { error: "bad_voice", message: "Pick one of your voices first." });
  if (!text.trim()) return json(400, { error: "empty", message: "There's no text to read." });
  if (text.length > MAX_TEXT) return json(413, { error: "too_long" });

  const res = await fetch(
    ELEVEN + "/v1/text-to-speech/" + voiceId + "/with-timestamps?output_format=mp3_44100_128",
    {
      method: "POST",
      headers: elevenHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ text, model_id: MODEL }),
    }
  );
  if (!res.ok) return elevenError(res);
  const data = await res.json();
  const a = data.alignment || {};
  return json(200, {
    audio: data.audio_base64,
    starts: Array.isArray(a.character_start_times_seconds) ? a.character_start_times_seconds : [],
  });
};

export const config = { path: "/api/speak" };
