// Shared helpers for the "your own voice" API. The ElevenLabs key never
// reaches the browser: it lives in Netlify's environment variables.
import { createHash, timingSafeEqual } from "node:crypto";

export const ELEVEN = "https://api.elevenlabs.io";
export const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function sha(s) { return createHash("sha256").update(String(s)).digest(); }

// Only the site owner (who knows VOICE_PASSWORD) can clone or speak, so
// strangers can't spend your credits or clone someone else's voice.
export async function guard(req) {
  const key = process.env.ELEVENLABS_API_KEY;
  const pass = process.env.VOICE_PASSWORD;
  if (!key || !pass) {
    return json(503, {
      error: "not_set_up",
      message: "Voice cloning isn't switched on yet. Add ELEVENLABS_API_KEY and VOICE_PASSWORD in Netlify (see voice/README.md).",
    });
  }
  const got = req.headers.get("x-voice-password") || "";
  if (!timingSafeEqual(sha(got), sha(pass))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return json(401, { error: "wrong_password", message: "Wrong owner password." });
  }
  return null;
}

export function elevenHeaders(extra) {
  return Object.assign({ "xi-api-key": process.env.ELEVENLABS_API_KEY }, extra || {});
}

// Turn an ElevenLabs error into a plain sentence for the page.
export async function elevenError(res) {
  let detail = {};
  try { detail = (await res.json()).detail || {}; } catch { /* not JSON */ }
  const code = typeof detail === "object" ? detail.status || detail.code || "" : "";
  const msg = typeof detail === "string" ? detail : detail.message || "";
  let message;
  if (res.status === 401) message = "ElevenLabs didn't accept the API key. Check ELEVENLABS_API_KEY in Netlify.";
  else if (/instant_voice_cloning|can_not_use|subscription|plan/i.test(code + " " + msg)) message = "Voice cloning needs a paid ElevenLabs plan (Starter or higher).";
  else if (/quota|credits|limit/i.test(code + " " + msg) || res.status === 402) message = "Your ElevenLabs credits have run out for this month.";
  else if (res.status === 429) message = "ElevenLabs is busy. Wait a moment and try again.";
  else message = "ElevenLabs said: " + (msg || "error " + res.status);
  return json(res.status >= 500 ? 502 : res.status, { error: code || "elevenlabs", message });
}

export const VOICE_ID = /^[A-Za-z0-9]{1,64}$/;
