// GET /api/voices — your cloned voices (also used to check the password).
// DELETE /api/voices?id=... — delete one of them.
import { ELEVEN, guard, json, elevenHeaders, elevenError, VOICE_ID } from "../shared/eleven.mjs";

export default async (req) => {
  const denied = await guard(req);
  if (denied) return denied;

  if (req.method === "GET") {
    const res = await fetch(ELEVEN + "/v1/voices", { headers: elevenHeaders() });
    if (!res.ok) return elevenError(res);
    const data = await res.json();
    const voices = (data.voices || [])
      .filter((v) => v.category === "cloned")
      .map((v) => ({ id: v.voice_id, name: v.name }));
    return json(200, { voices });
  }

  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!VOICE_ID.test(id)) return json(400, { error: "bad_id" });
    const res = await fetch(ELEVEN + "/v1/voices/" + id, { method: "DELETE", headers: elevenHeaders() });
    if (!res.ok) return elevenError(res);
    return json(200, { ok: true });
  }

  return json(405, { error: "method" });
};

export const config = { path: "/api/voices" };
