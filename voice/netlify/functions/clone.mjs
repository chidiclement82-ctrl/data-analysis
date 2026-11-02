// POST /api/clone — body: WAV audio (made in the browser from your video).
// Headers: x-voice-name, x-consent: yes. Returns { id, name }.
import { ELEVEN, guard, json, elevenHeaders, elevenError } from "../lib/eleven.mjs";

const MAX_BYTES = 5.5 * 1024 * 1024;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const denied = await guard(req);
  if (denied) return denied;

  if (req.headers.get("x-consent") !== "yes") {
    return json(400, { error: "consent", message: "Please confirm this is your own voice (or you have permission)." });
  }
  let name = "";
  try { name = decodeURIComponent(req.headers.get("x-voice-name") || ""); } catch { /* bad header */ }
  name = name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || "My voice";

  const audio = await req.arrayBuffer();
  if (audio.byteLength < 1000) return json(400, { error: "empty", message: "No sound was received." });
  if (audio.byteLength > MAX_BYTES) return json(413, { error: "too_big", message: "That sample is too long. Use up to 90 seconds." });

  const form = new FormData();
  form.append("name", name);
  form.append("description", "Cloned in Voice Reader by the site owner, with consent.");
  form.append("remove_background_noise", "true");
  form.append("files", new Blob([audio], { type: "audio/wav" }), "sample.wav");

  const res = await fetch(ELEVEN + "/v1/voices/add", { method: "POST", headers: elevenHeaders(), body: form });
  if (!res.ok) return elevenError(res);
  const data = await res.json();
  return json(200, { id: data.voice_id, name });
};

export const config = { path: "/api/clone" };
