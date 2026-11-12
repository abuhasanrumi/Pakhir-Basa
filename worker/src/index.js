// Pakhir Basa AI Worker
//   POST /transcribe  body: raw audio bytes        -> { text }
//   POST /parse       body: { text, ...context }   -> { draft }
// Every request must carry a Firebase ID token from the app's own project.
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const LLM = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARS = 600;

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Language",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders(request, env) } });
}

async function verifyUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("missing token");
  const projectId = env.FIREBASE_PROJECT_ID;

  if (env.ALLOW_UNSIGNED_DEV_TOKENS === "true") {
    // Auth emulator tokens are unsigned; only accepted when explicitly enabled for local dev.
    const claims = decodeJwt(token);
    if (claims.aud !== projectId) throw new Error("wrong project");
    return claims;
  }

  const { payload } = await jwtVerify(token, googleKeys, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  if (!payload.email || payload.email_verified === false) throw new Error("unverified email");
  return payload;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function transcribe(request, env) {
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json(request, env, { error: "No audio received." }, 400);
  if (audio.byteLength > MAX_AUDIO_BYTES) return json(request, env, { error: "Recording is too long. Keep it under about a minute." }, 413);

  const language = request.headers.get("X-Language") || "";
  const hint = new URL(request.url).searchParams.get("hint") || "";
  const input = {
    audio: toBase64(audio),
    task: "transcribe",
    vad_filter: true,
    initial_prompt: `Meal tracker for a shared house in Bangladesh. Names: ${hint.slice(0, 300)}. Words: lunch, dinner, deposit, bKash, Nagad, taka, bazaar, meal.`,
  };
  if (language) input.language = language;
  const result = await env.AI.run(WHISPER, input);
  return json(request, env, { text: String(result?.text || "").trim(), language: result?.transcription_info?.language || null });
}

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["meal", "deposit", "merchant", "bazaar", "question", "unknown"] },
    date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    session: { type: ["string", "null"], enum: ["lunch", "dinner", null] },
    skipped: { type: "boolean", description: "true when the user says there was no lunch/dinner" },
    portions: {
      type: "array",
      items: { type: "object", properties: { memberId: { type: "string" }, count: { type: "number" } }, required: ["memberId", "count"] },
    },
    amount: { type: ["number", "null"] },
    memberId: { type: ["string", "null"], description: "who paid a deposit" },
    method: { type: ["string", "null"], enum: ["Cash", "bKash", "Nagad", "Bank", null] },
    category: { type: ["string", "null"], enum: ["bazaar", "utility", "other", null] },
    note: { type: ["string", "null"] },
    summary: { type: "string", maxLength: 120, description: "at most 15 words describing the draft; no reasoning" },
  },
  required: ["intent", "summary"],
};

export function systemPrompt(context) {
  const members = (context.members || []).map((person) => `- ${person.name} (id: ${person.id})`).join("\n");
  return [
    "You turn what a member of a Bangladeshi bachelor mess says (Bangla, English or Banglish) into a JSON draft for their meal tracker app.",
    "The app saves nothing on its own; a person reviews your draft first. When unsure, leave a field null rather than guessing.",
    "",
    `Today is ${context.today} (${context.weekday}). Time now: ${context.time}. The speaker is ${context.me?.name} (id: ${context.me?.id})${context.isAdmin ? ", an admin" : ""}.`,
    "People in this month (use these ids exactly; match nicknames and Bangla spellings to the closest name):",
    members || "- (none)",
    "",
    "Intents:",
    "- meal: who ate lunch or dinner on a date. portions = one entry per person with their meal count (1 each unless said otherwise; 0.5 = half; guests add to the host's count, e.g. 'Topu and his guest' = Topu 2). 'everyone'/'সবাই' means every person listed. 'except X'/'X ছাড়া' removes X. If they say there was no lunch/dinner, set skipped true and portions [].",
    "- deposit: someone gave money to the mess. amount, memberId (default the speaker), method if said (bKash, Nagad, Bank, else Cash), note optional.",
    "- merchant: the mess paid the meal supplier/merchant/hotel/khala from mess cash. amount, note optional.",
    "- bazaar: shopping or a shared cost paid from mess cash. amount, note = what was bought, category bazaar/utility/other.",
    "- question: they ask something (balance, who owes, meal rate, totals). Just set intent question; another step writes the answer.",
    "- unknown: anything else; explain in summary what you need.",
    "",
    "Dates: 'today/আজ/aj' = today. 'yesterday/গতকাল/gotokal/gotokaal' = the day before today.",
    "'কাল/kal/kaal' alone is ambiguous in Bangla: with a past-tense verb (খেয়েছে, খেয়েছিল, হয়নি, দিয়েছে, kheyeche, hoyni, diyeche, ate, paid) it means YESTERDAY; only with a clearly future verb (খাবে, হবে, khabe, will) does it mean tomorrow.",
    "'tomorrow/আগামীকাল' = the day after. A weekday name means the most recent one, not a future day. Meals and payments are almost always for today or the past. Default date = today.",
    "Session: 'দুপুর/lunch' = lunch, 'রাত/dinner/রাতের' = dinner. If not said, use lunch before 4 PM, otherwise dinner.",
    "Numbers: convert Bangla digits (০১২৩৪৫৬৭৮৯) and words (এক, দুই, দেড় = 1.5, আধা = 0.5, হাজার = 1000, শ = 100). Amounts are in taka.",
    "",
    "Data for answering questions (this month):",
    JSON.stringify(context.data || {}).slice(0, 4000),
    "",
    "Reply with JSON only. Keep summary to one short sentence (at most 15 words) describing the draft; never explain your reasoning.",
    "Language: if the user wrote Bangla script, write summary and answer in Bangla. If they wrote English or Banglish (Bangla in English letters), write them in English.",
  ].join("\n");
}

// Questions get a separate plain-text answer: short, from the month's data only.
async function answerQuestion(env, context, text) {
  const result = await env.AI.run(LLM, {
    messages: [
      {
        role: "system",
        content: [
          "You answer questions from members of a shared house (mess) meal tracker in Bangladesh.",
          `The person asking is ${context.me?.name}. Today is ${context.today}.`,
          "Use only this data for the current month. Amounts are taka. balance < 0 means they still owe that much; balance > 0 means money left over.",
          JSON.stringify(context.data || {}).slice(0, 4000),
          "Never show negative numbers: say someone 'owes ৳X' / 'X টাকা দিতে হবে' or 'has ৳X left' / 'X টাকা জমা আছে'. Write amounts with the ৳ sign.",
          "Answer in at most 2 short sentences. If they wrote Bangla script, answer in Bangla; otherwise answer in English. If the data does not have the answer, say so.",
        ].join("\n"),
      },
      { role: "user", content: text },
    ],
    temperature: 0.2,
    max_tokens: 160,
  });
  return String(result?.response || "").trim();
}

async function parse(request, env) {
  const body = await request.json().catch(() => null);
  const text = String(body?.text || "").trim().slice(0, MAX_TEXT_CHARS);
  if (!text) return json(request, env, { error: "Say or type something first." }, 400);

  const result = await env.AI.run(LLM, {
    messages: [
      { role: "system", content: systemPrompt(body) },
      { role: "user", content: text },
    ],
    response_format: { type: "json_schema", json_schema: DRAFT_SCHEMA },
    temperature: 0.1,
    max_tokens: 500,
  });

  let draft = result?.response;
  if (typeof draft === "string") {
    try {
      draft = JSON.parse(draft);
    } catch {
      draft = null;
    }
  }
  if (!draft || typeof draft !== "object") return json(request, env, { error: "Couldn’t understand that. Try saying it a bit differently." }, 422);
  if (draft.intent === "question") draft.answer = await answerQuestion(env, body, text);
  return json(request, env, { draft });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || !["/transcribe", "/parse"].includes(pathname)) {
      return json(request, env, { error: "Not found" }, 404);
    }

    try {
      await verifyUser(request, env);
    } catch {
      return json(request, env, { error: "Please sign in again." }, 401);
    }

    try {
      return pathname === "/transcribe" ? await transcribe(request, env) : await parse(request, env);
    } catch (error) {
      console.error(pathname, error);
      return json(request, env, { error: "The AI service had a problem. Please try again." }, 502);
    }
  },
};
