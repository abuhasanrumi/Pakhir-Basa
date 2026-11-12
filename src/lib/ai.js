import { auth } from "../firebase";

// Cloudflare Worker that does speech-to-text and turns text into a form draft.
export const AI_URL = (import.meta.env.VITE_AI_URL || "").replace(/\/$/, "");
export const aiEnabled = Boolean(AI_URL);

async function authHeader() {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in again.");
  return { Authorization: `Bearer ${token}` };
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The AI service had a problem. Please try again.");
  return body;
}

export async function transcribeAudio(blob, { hint = "" } = {}) {
  const response = await fetch(`${AI_URL}/transcribe?hint=${encodeURIComponent(hint)}`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  return readJson(response);
}

export async function parseCommand(payload) {
  const response = await fetch(`${AI_URL}/parse`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson(response);
}

// Best recording format this browser supports (iPhone Safari records mp4/aac).
export function pickAudioType() {
  if (typeof MediaRecorder === "undefined") return "";
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}
