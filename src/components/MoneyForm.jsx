import { Check } from "lucide-react";
import { useState } from "react";
import { trackEvent, trackFormError } from "../analytics";
import { addRecord, updateRecord } from "../firebase";
import { formatTk, today } from "../lib/format";
import { DateInput } from "./DateInput.jsx";

export const MONEY_KINDS = {
  deposit: { title: "Add deposit", editTitle: "Edit deposit", collection: "deposits", chips: [500, 1000, 2000, 3000] },
  merchant: { title: "Paid to merchant", editTitle: "Edit merchant payment", collection: "expenses", chips: [500, 1000, 2000] },
  bazaar: { title: "Add bazaar", editTitle: "Edit bazaar", collection: "expenses", chips: [200, 500, 1000] },
};

const DEPOSIT_METHODS = ["Cash", "bKash", "Nagad", "Bank"];
const BAZAAR_CATEGORIES = [
  { id: "bazaar", label: "Bazaar" },
  { id: "utility", label: "Utility" },
  { id: "other", label: "Other" },
];

export function moneyKindOf(entry) {
  if (!entry) return null;
  if (entry.memberId !== undefined && entry.title === undefined) return "deposit";
  if (entry.category === "meal") return "merchant";
  return "bazaar";
}

// Amount-first form for deposits, merchant payments and bazaar. Pass `entry` to edit.
export function MoneyForm({ activeMembers, currentCycle, dueToMerchant = 0, entry, isAdmin, kind, member, onDone, setMessage }) {
  const config = MONEY_KINDS[kind];
  const [amount, setAmount] = useState(entry ? String(entry.amount ?? "") : "");
  const [date, setDate] = useState(entry?.date || today());
  const [memberId, setMemberId] = useState(entry?.memberId || member.id);
  const [method, setMethod] = useState(entry?.method || "Cash");
  const [note, setNote] = useState(entry?.note || (kind === "bazaar" ? entry?.title || "" : ""));
  const [category, setCategory] = useState(entry?.category && entry.category !== "meal" ? entry.category : "bazaar");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const numericAmount = Number(amount);
  const people = isAdmin ? activeMembers : activeMembers.filter((person) => person.id === member.id);
  const personName = activeMembers.find((person) => person.id === memberId)?.name || member.name;

  async function submit(event) {
    event.preventDefault();
    if (!(numericAmount > 0)) {
      setError("Enter an amount.");
      trackFormError(kind, "missing_amount");
      return;
    }
    if (kind === "deposit" && !memberId) {
      setError("Choose who paid.");
      trackFormError(kind, "missing_member");
      return;
    }

    let payload;
    if (kind === "deposit") {
      payload = { date, memberId, amount: numericAmount, method, note: note.trim() };
    } else {
      payload = {
        date,
        title: kind === "merchant" ? "Paid to merchant" : note.trim() || "Bazaar",
        category: kind === "merchant" ? "meal" : category,
        amount: numericAmount,
        note: kind === "merchant" ? note.trim() : "",
        payerId: "mess_cash",
        splitMethod: "mess_fund",
        participants: [],
        customShares: {},
      };
    }

    try {
      setIsSaving(true);
      if (entry) {
        await updateRecord(config.collection, entry.id, payload);
        setMessage("Saved.");
        trackEvent(`${kind}_edited`, { amount: numericAmount });
      } else {
        await addRecord(config.collection, {
          ...payload,
          messId: currentCycle.messId,
          cycleId: currentCycle.id,
          status: isAdmin ? "approved" : "pending",
          createdBy: member.id,
          createdByName: member.name,
        });
        const label = kind === "deposit" ? `Deposit of ${formatTk(numericAmount)} added for ${personName}` : kind === "merchant" ? `Merchant payment of ${formatTk(numericAmount)} added` : `Bazaar of ${formatTk(numericAmount)} added`;
        setMessage(isAdmin ? `${label}.` : `${label}. An admin will review it.`);
        trackEvent(kind === "deposit" ? "deposit_created" : kind === "merchant" ? "merchant_payment_created" : "expense_created", {
          status: isAdmin ? "approved" : "pending",
          amount: numericAmount,
          method: kind === "deposit" ? method : undefined,
        });
      }
      onDone?.();
    } catch (saveError) {
      console.error("Money save failed", saveError);
      setError(saveError.code === "permission-denied" ? "You can’t change this one." : saveError.message);
    } finally {
      setIsSaving(false);
    }
  }

  const saveLabel = numericAmount > 0
    ? kind === "deposit"
      ? `${entry ? "Save" : "Add"} ${formatTk(numericAmount)} from ${personName}`
      : `${entry ? "Save" : "Add"} ${formatTk(numericAmount)}`
    : entry ? "Save changes" : "Add";

  return (
    <form className="money-form" onSubmit={submit}>
      <label className="amount-field">
        <span>Amount</span>
        <div className="amount-field__input">
          <b>৳</b>
          <input
            autoFocus={!entry}
            enterKeyHint="done"
            inputMode="decimal"
            min="0"
            placeholder="0"
            step="any"
            type="number"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
          />
        </div>
      </label>

      <div className="chip-row" aria-label="Quick amounts">
        {kind === "merchant" && dueToMerchant > 0 ? (
          <button className={numericAmount === dueToMerchant ? "chip active" : "chip chip--accent"} type="button" onClick={() => setAmount(String(dueToMerchant))}>
            Full due {formatTk(dueToMerchant)}
          </button>
        ) : null}
        {config.chips.map((value) => (
          <button className={numericAmount === value ? "chip active" : "chip"} key={value} type="button" onClick={() => setAmount(String(value))}>
            {formatTk(value)}
          </button>
        ))}
      </div>

      {kind === "deposit" ? (
        <>
          <div className="field-block">
            <span className="field-label">From</span>
            <div className="chip-row chip-row--wrap" role="radiogroup" aria-label="Who paid">
              {people.map((person) => (
                <button aria-checked={memberId === person.id} className={memberId === person.id ? "chip person-chip active" : "chip person-chip"} key={person.id} role="radio" type="button" onClick={() => setMemberId(person.id)}>
                  <span aria-hidden="true">{person.name?.[0]?.toUpperCase()}</span>
                  {person.id === member.id ? `${person.name} (you)` : person.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field-block">
            <span className="field-label">Paid by</span>
            <div className="chip-row chip-row--wrap" role="radiogroup" aria-label="Payment method">
              {DEPOSIT_METHODS.map((value) => (
                <button aria-checked={method === value} className={method === value ? "chip active" : "chip"} key={value} role="radio" type="button" onClick={() => setMethod(value)}>
                  {value}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {kind === "bazaar" ? (
        <div className="field-block">
          <span className="field-label">Type</span>
          <div className="chip-row chip-row--wrap" role="radiogroup" aria-label="Expense type">
            {BAZAAR_CATEGORIES.map((item) => (
              <button aria-checked={category === item.id} className={category === item.id ? "chip active" : "chip"} key={item.id} role="radio" type="button" onClick={() => setCategory(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="money-form__row">
        <label className="money-form__date">
          Date
          <DateInput label="Date" showToday value={date} onChange={setDate} />
        </label>
        <label className="money-form__note">
          {kind === "bazaar" ? "What was bought" : "Note (optional)"}
          <input placeholder={kind === "bazaar" ? "Fish, rice, vegetables…" : kind === "deposit" ? "Advance for November" : "Receipt no., merchant name…"} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>

      {kind === "merchant" ? <p className="money-form__hint">Paid from mess cash. It lowers mess cash and what the mess still owes the merchant.</p> : null}
      {!isAdmin && !entry ? <p className="money-form__hint">An admin will approve this before it counts.</p> : null}
      {error ? <div className="meal-form-error">{error}</div> : null}

      <button className="primary money-form__submit" disabled={isSaving} type="submit">
        <Check size={18} /> {isSaving ? "Saving…" : saveLabel}
      </button>
    </form>
  );
}
