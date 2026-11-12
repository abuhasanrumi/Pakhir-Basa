import { ArrowUp, Check, Loader2, Mic, RotateCcw, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "../analytics";
import { parseCommand, pickAudioType, transcribeAudio } from "../lib/ai";
import { taka } from "../lib/calculations";
import { formatDisplayDate, formatTk, localDateString, today } from "../lib/format";
import { Sheet } from "./Sheet.jsx";

const MAX_SECONDS = 45;
const EXAMPLES = ["আজ দুপুরে সবাই এক করে, টপু দুই", "Topu deposited 1000 by bKash", "Paid the meal merchant 2000", "How much do I owe?"];

// "Say or type it": voice or text -> AI draft -> the person checks it and fills the real form.
export function AssistantSheet({ activeMembers, isAdmin, isCalculatedMonth, ledger, member, onApply, onClose, totals }) {
  const [status, setStatus] = useState("idle"); // idle | recording | transcribing | thinking | done | error
  const [text, setText] = useState("");
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const canRecord = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(pickAudioType());

  useEffect(() => () => stopTimer(), []);

  function stopTimer() {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function contextPayload(spoken) {
    const now = new Date();
    return {
      text: spoken,
      today: today(),
      weekday: now.toLocaleDateString("en", { weekday: "long" }),
      time: now.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }),
      me: { id: member.id, name: member.name },
      isAdmin,
      members: activeMembers.map((person) => ({ id: person.id, name: person.name })),
      data: {
        mealRate: taka(totals?.mealRate || 0),
        totalMeals: totals?.boxes,
        mealCost: totals?.meals,
        people: activeMembers.map((person) => {
          const row = ledger?.[person.id];
          return { name: person.name, meals: taka(row?.mealCount || 0), paid: taka(row?.deposits || 0), balance: taka(row?.balance || 0) };
        }),
        note: "balance < 0 means they still owe that much; balance > 0 means they have money left.",
      },
    };
  }

  async function understand(spoken) {
    const value = spoken.trim();
    if (!value) return;
    setStatus("thinking");
    setError("");
    setDraft(null);
    try {
      const { draft: result } = await parseCommand(contextPayload(value));
      setDraft(cleanDraft(result));
      setStatus("done");
      trackEvent("assistant_understood", { intent: result?.intent || "unknown" });
    } catch (parseError) {
      setError(parseError.message);
      setStatus("error");
    }
  }

  function cleanDraft(result) {
    const ids = new Set(activeMembers.map((person) => person.id));
    const portions = (result?.portions || [])
      .filter((item) => ids.has(item.memberId) && Number(item.count) > 0)
      .filter((item) => isAdmin || item.memberId === member.id)
      .map((item) => ({ memberId: item.memberId, count: Math.min(10, taka(Number(item.count))) }));
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(result?.date || "") ? result.date : today();
    return {
      ...result,
      date: validDate,
      session: result?.session === "dinner" || result?.session === "lunch" ? result.session : new Date().getHours() < 16 ? "lunch" : "dinner",
      portions,
      memberId: ids.has(result?.memberId) && (isAdmin || result?.memberId === member.id) ? result.memberId : member.id,
      amount: Number(result?.amount) > 0 ? taka(Number(result.amount)) : null,
      intent: result?.intent === "bazaar" && !isCalculatedMonth ? "merchant" : result?.intent || "unknown",
    };
  }

  async function startRecording() {
    setError("");
    setDraft(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = pickAudioType();
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        stopTimer();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || type || "audio/webm" });
        if (blob.size < 1200) {
          setStatus("idle");
          setError("That was too short. Hold on a moment longer.");
          return;
        }
        setStatus("transcribing");
        try {
          const hint = activeMembers.map((person) => person.name).join(", ");
          const { text: spoken } = await transcribeAudio(blob, { hint });
          if (!spoken) throw new Error("Didn’t catch that. Try again a little closer to the mic.");
          setText(spoken);
          trackEvent("assistant_voice_transcribed", { seconds });
          await understand(spoken);
        } catch (voiceError) {
          setError(voiceError.message);
          setStatus("error");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setStatus("recording");
      timerRef.current = window.setInterval(() => {
        setSeconds((value) => {
          if (value + 1 >= MAX_SECONDS) recorderRef.current?.state === "recording" && recorderRef.current.stop();
          return value + 1;
        });
      }, 1000);
    } catch (micError) {
      setError(micError?.name === "NotAllowedError" ? "Microphone permission is off. Allow it in your browser settings, or type instead." : "Couldn’t start the microphone. You can type instead.");
      setStatus("idle");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  const busy = status === "transcribing" || status === "thinking";

  return (
    <Sheet title="Say or type it" onClose={onClose}>
      <div className="assistant">
        {!draft ? (
          <>
            {canRecord ? (
              <div className="assistant__mic-wrap">
                <button
                  aria-label={status === "recording" ? "Stop recording" : "Start recording"}
                  className={`assistant__mic${status === "recording" ? " recording" : ""}`}
                  disabled={busy}
                  type="button"
                  onClick={status === "recording" ? stopRecording : startRecording}
                >
                  {busy ? <Loader2 className="spin" size={30} /> : status === "recording" ? <Square size={26} /> : <Mic size={30} />}
                </button>
                <p className="assistant__hint">
                  {status === "recording"
                    ? `Listening… ${seconds}s · tap to stop`
                    : status === "transcribing"
                      ? "Turning your voice into text…"
                      : status === "thinking"
                        ? "Understanding…"
                        : "Tap and speak in Bangla or English"}
                </p>
              </div>
            ) : null}

            <form
              className="assistant__input"
              onSubmit={(event) => {
                event.preventDefault();
                trackEvent("assistant_typed");
                understand(text);
              }}
            >
              <textarea
                aria-label="What happened"
                disabled={busy || status === "recording"}
                placeholder={canRecord ? "…or type it here" : "Type what happened, e.g. lunch today everyone 1, Topu 2"}
                rows={2}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends; Shift+Enter adds a new line. Skip while an IME (e.g. Bangla keyboard) is composing.
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (text.trim() && !busy) understand(text);
                  }
                }}
              />
              <button aria-label="Send" className="primary" disabled={busy || !text.trim()} type="submit">
                {status === "thinking" ? <Loader2 className="spin" size={18} /> : <ArrowUp size={18} />}
              </button>
            </form>

            {error ? <div className="meal-form-error">{error}</div> : null}

            <div className="assistant__examples">
              <span>Try</span>
              {EXAMPLES.map((example) => (
                <button className="chip" disabled={busy} key={example} type="button" onClick={() => setText(example)}>
                  {example}
                </button>
              ))}
            </div>
          </>
        ) : (
          <DraftCard
            activeMembers={activeMembers}
            draft={draft}
            heard={text}
            onApply={() => {
              trackEvent("assistant_draft_applied", { intent: draft.intent });
              onApply(draft);
            }}
            onRetry={() => {
              setDraft(null);
              setStatus("idle");
            }}
          />
        )}
      </div>
    </Sheet>
  );
}

function DraftCard({ activeMembers, draft, heard, onApply, onRetry }) {
  const nameOf = (id) => activeMembers.find((person) => person.id === id)?.name || "Someone";
  const canApply = (draft.intent === "meal" && (draft.portions.length || draft.skipped)) || (["deposit", "merchant", "bazaar"].includes(draft.intent) && draft.amount);
  const mealCount = taka(draft.portions.reduce((sum, item) => sum + item.count, 0));
  const dateLabel = draft.date === today() ? "Today" : draft.date === localDateString(new Date(Date.now() - 86400000)) ? "Yesterday" : formatDisplayDate(draft.date);

  return (
    <div className="draft">
      <p className="draft__heard">
        <Sparkles size={14} /> “{heard}”
      </p>
      {draft.summary && draft.intent !== "question" ? <p className="draft__summary">{draft.summary}</p> : null}

      {draft.intent === "meal" ? (
        <div className="draft__box">
          <div className="draft__row">
            <span>{draft.session === "lunch" ? "Lunch" : "Dinner"}</span>
            <strong>{dateLabel}</strong>
          </div>
          {draft.skipped ? (
            <div className="draft__row">
              <span>No {draft.session} that day</span>
            </div>
          ) : (
            <>
              {draft.portions.map((item) => (
                <div className="draft__row" key={item.memberId}>
                  <span>{nameOf(item.memberId)}</span>
                  <strong>
                    {item.count} meal{item.count === 1 ? "" : "s"}
                  </strong>
                </div>
              ))}
              <div className="draft__row draft__row--total">
                <span>Total</span>
                <strong>
                  {mealCount} meal{mealCount === 1 ? "" : "s"}
                </strong>
              </div>
            </>
          )}
        </div>
      ) : null}

      {["deposit", "merchant", "bazaar"].includes(draft.intent) ? (
        <div className="draft__box">
          <div className="draft__row">
            <span>{draft.intent === "deposit" ? "Deposit" : draft.intent === "merchant" ? "Paid to merchant" : "Bazaar"}</span>
            <strong>{draft.amount ? formatTk(draft.amount) : "Amount missing"}</strong>
          </div>
          {draft.intent === "deposit" ? (
            <div className="draft__row">
              <span>From</span>
              <strong>
                {nameOf(draft.memberId)}
                {draft.method ? ` · ${draft.method}` : ""}
              </strong>
            </div>
          ) : null}
          <div className="draft__row">
            <span>Date</span>
            <strong>{dateLabel}</strong>
          </div>
          {draft.note ? (
            <div className="draft__row">
              <span>Note</span>
              <strong>{draft.note}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.intent === "question" ? <div className="draft__answer">{draft.answer || "I couldn’t find that in this month’s data."}</div> : null}
      {draft.intent === "unknown" ? <div className="draft__answer">{draft.summary || "I didn’t understand. Try saying who ate, or who paid how much."}</div> : null}

      <div className="entry-detail__actions">
        {canApply ? (
          <button className="primary" type="button" onClick={onApply}>
            <Check size={18} /> Check and save
          </button>
        ) : null}
        <button className="secondary" type="button" onClick={onRetry}>
          <RotateCcw size={18} /> {canApply ? "Change" : draft.intent === "question" ? "Ask another" : "Try again"}
        </button>
      </div>
      {canApply ? <p className="money-form__hint">This opens the form filled in. Nothing is saved until you tap Save there.</p> : null}
    </div>
  );
}
