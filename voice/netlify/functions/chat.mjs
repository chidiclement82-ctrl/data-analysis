// POST /api/chat — { setup, messages: [{role, content}] } → { reply }
// The AI's half of a spoken conversation. The page then reads the reply
// aloud in your cloned voice with /api/speak.
import Anthropic from "@anthropic-ai/sdk";
import { guard, json } from "../shared/eleven.mjs";

const MODEL = process.env.CHAT_MODEL || "claude-opus-5-5";
const MAX_TURNS = 40;        // older turns are dropped so requests stay small
const MAX_SETUP = 4000;
const MAX_MESSAGE = 4000;

let client;

function systemPrompt(setup) {
  return [
    "You are having a live, spoken conversation. Your words are turned into speech in the site owner's own cloned voice and played aloud, and the other person answers by talking.",
    "Speak naturally, like a real person on a call: usually one to three short sentences, then let them talk. Go longer only when they ask for detail or a story.",
    "Write only words meant to be said out loud: no markdown, lists, headings, emojis, stage directions or text in brackets. Write numbers, dates and symbols the way you'd say them.",
    "Their words come from speech recognition, so expect missing punctuation and misheard words; go with the most likely meaning, and ask them to repeat only if you really can't tell.",
    "Answer in the language they speak to you in unless the conversation setup says otherwise.",
    "",
    "The site owner described the conversation they want like this. Follow it: it sets who you are, the topic and the tone.",
    "<conversation_setup>",
    setup || "A friendly, relaxed everyday chat.",
    "</conversation_setup>",
  ].join("\n");
}

function cleanMessages(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const m of list.slice(-MAX_TURNS)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    const content = String(m.content || "").slice(0, MAX_MESSAGE).trim();
    if (content) out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift(); // must start with the person
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const denied = await guard(req);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(503, {
      error: "not_set_up",
      message: "Talking isn't switched on yet. Add ANTHROPIC_API_KEY in Netlify (see voice/README.md).",
    });
  }

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  const messages = cleanMessages(body.messages);
  if (!messages) return json(400, { error: "bad_messages", message: "Say something first." });
  const setup = String(body.setup || "").slice(0, MAX_SETUP).trim();

  client = client || new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      // Low effort keeps replies quick, which matters in a spoken conversation.
      output_config: { effort: "low" },
      // If a safety check declines a turn, the API retries it on a suitable model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: systemPrompt(setup),
      messages,
    });

    if (response.stop_reason === "refusal") {
      return json(200, { reply: "Sorry, I can't help with that one. Let's talk about something else.", refused: true });
    }
    const reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!reply) return json(502, { error: "empty", message: "The AI didn't answer. Try again." });
    return json(200, { reply });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return json(502, { error: "auth", message: "The Anthropic API key wasn't accepted. Check ANTHROPIC_API_KEY in Netlify." });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return json(429, { error: "busy", message: "Too many requests right now. Wait a moment and try again." });
    }
    if (error instanceof Anthropic.BadRequestError) {
      return json(400, { error: "bad_request", message: "The AI couldn't take that request: " + error.message });
    }
    if (error instanceof Anthropic.APIError) {
      return json(502, { error: "api", message: "The AI service had a problem (" + (error.status || "network") + "). Try again." });
    }
    throw error;
  }
};

export const config = { path: "/api/chat" };
