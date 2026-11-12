import { ArrowDownLeft, ArrowUpRight, Check, Clock, HandCoins, Pencil, ShoppingBasket, Store, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { trackEvent } from "../analytics";
import { ConfirmModal } from "../components/ConfirmModal.jsx";
import { MONEY_KINDS, MoneyForm, moneyKindOf } from "../components/MoneyForm.jsx";
import { Sheet } from "../components/Sheet.jsx";
import { deleteRecord, updateRecord } from "../firebase";
import { taka } from "../lib/calculations";
import { formatDisplayDate, formatTk, today } from "../lib/format";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "deposit", label: "Deposits" },
  { id: "merchant", label: "Merchant" },
  { id: "bazaar", label: "Bazaar", calculatedOnly: true },
  { id: "mine", label: "Mine" },
];

function dayLabel(date) {
  const todayDate = today();
  const yesterday = new Date(`${todayDate}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === todayDate) return "Today";
  if (date === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return formatDisplayDate(date);
}

function createdSeconds(item) {
  return Number(item.createdAt?.seconds || 0);
}

// One feed for every money movement this month: deposits in, merchant payments and bazaar out.
export function Money({ activeMembers, currentCycle, deposits, expenses, isAdmin, isCalculatedMonth, member, messCash, onAdd, setMessage, totals }) {
  const [filter, setFilter] = useState("all");
  const [openItem, setOpenItem] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const nameOf = (memberId) => activeMembers.find((person) => person.id === memberId)?.name || "Former member";

  const items = useMemo(() => {
    const depositItems = deposits.map((item) => ({ ...item, kind: "deposit", collection: "deposits" }));
    const expenseItems = expenses
      .filter((item) => isCalculatedMonth || (item.category === "meal" && item.payerId === "mess_cash"))
      .map((item) => ({ ...item, kind: item.category === "meal" ? "merchant" : "bazaar", collection: "expenses" }));
    return [...depositItems, ...expenseItems]
      .filter((item) => isAdmin || item.status === "approved" || item.createdBy === member.id || item.memberId === member.id)
      .sort((left, right) => String(right.date).localeCompare(String(left.date)) || createdSeconds(right) - createdSeconds(left));
  }, [deposits, expenses, isAdmin, isCalculatedMonth, member.id]);

  const approved = items.filter((item) => item.status === "approved");
  const collected = taka(approved.filter((item) => item.kind === "deposit").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const paidMerchant = taka(approved.filter((item) => item.kind === "merchant").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const bazaarSpent = taka(approved.filter((item) => item.kind === "bazaar").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const dueToMerchant = Math.max(0, taka(Number(totals.meals || 0) - paidMerchant));
  const pending = items.filter((item) => item.status === "pending");

  const filtered = items.filter((item) => {
    if (filter === "all") return item.status !== "pending" || !isAdmin;
    if (filter === "mine") return item.memberId === member.id || item.createdBy === member.id;
    return item.kind === filter && (item.status !== "pending" || !isAdmin);
  });
  const groups = filtered.reduce((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else acc.push({ date: item.date, items: [item] });
    return acc;
  }, []);

  function canEdit(item) {
    if (isAdmin) return true;
    return item.collection === "expenses" && item.createdBy === member.id && item.status === "pending";
  }

  async function approve(item) {
    await updateRecord(item.collection, item.id, { status: "approved" });
    trackEvent(`${item.kind === "deposit" ? "deposit" : item.kind === "merchant" ? "merchant_payment" : "expense"}_approved`, { amount: Number(item.amount || 0) });
    setMessage("Approved.");
    setOpenItem(null);
  }

  function describe(item) {
    if (item.kind === "deposit") {
      return {
        title: `${nameOf(item.memberId)} deposited`,
        detail: [item.method, item.note].filter(Boolean).join(" · ") || "Deposit",
        icon: HandCoins,
      };
    }
    if (item.kind === "merchant") {
      return { title: "Paid to merchant", detail: item.note || "From mess cash", icon: Store };
    }
    return { title: item.title || "Bazaar", detail: item.category === "bazaar" ? "Bazaar" : item.category, icon: ShoppingBasket };
  }

  function renderRow(item) {
    const info = describe(item);
    const Icon = info.icon;
    const isIn = item.kind === "deposit";
    return (
      <button className={`feed-row feed-row--${item.kind}`} key={`${item.collection}-${item.id}`} type="button" onClick={() => setOpenItem(item)}>
        <span className="feed-row__icon">
          <Icon size={18} />
        </span>
        <span className="feed-row__text">
          <strong>{info.title}</strong>
          <small>
            {info.detail}
            {item.createdByName && item.createdBy !== item.memberId ? ` · by ${item.createdByName}` : ""}
          </small>
        </span>
        <span className="feed-row__amount">
          <strong className={isIn ? "is-credit" : ""}>
            {isIn ? "+" : "−"}
            {formatTk(item.amount)}
          </strong>
          {item.status === "pending" ? (
            <small className="feed-row__pending">
              <Clock size={12} /> pending
            </small>
          ) : null}
        </span>
      </button>
    );
  }

  const openInfo = openItem ? describe(openItem) : null;

  return (
    <div className="money-screen">
      <section className="money-hero">
        <div className="money-hero__cash">
          <span>Mess cash</span>
          <strong>{formatTk(messCash)}</strong>
          <small>Money in hand right now</small>
        </div>
        <div className="money-hero__stats">
          <div>
            <ArrowDownLeft size={16} />
            <span>Collected</span>
            <strong>{formatTk(collected)}</strong>
          </div>
          {isCalculatedMonth ? (
            <div>
              <ArrowUpRight size={16} />
              <span>Bazaar</span>
              <strong>{formatTk(bazaarSpent)}</strong>
            </div>
          ) : null}
          <div>
            <ArrowUpRight size={16} />
            <span title="Paid to merchant">Paid</span>
            <strong>{formatTk(paidMerchant)}</strong>
          </div>
          {!isCalculatedMonth ? (
            <div className={dueToMerchant > 0 ? "is-warn" : ""}>
              <Store size={16} />
              <span>Still owed</span>
              <strong>{formatTk(dueToMerchant)}</strong>
            </div>
          ) : null}
        </div>
        <div className="money-hero__actions">
          <button className="primary" type="button" onClick={() => onAdd("deposit")}>
            <HandCoins size={18} /> Deposit
          </button>
          {isCalculatedMonth ? (
            <button className="secondary" type="button" onClick={() => onAdd("bazaar")}>
              <ShoppingBasket size={18} /> Bazaar
            </button>
          ) : null}
          <button className="secondary" type="button" onClick={() => onAdd("merchant")}>
            <Store size={18} /> Pay merchant
          </button>
        </div>
      </section>

      {isAdmin && pending.length ? (
        <section className="panel approvals">
          <h3>
            Waiting for approval <b>{pending.length}</b>
          </h3>
          {pending.map((item) => (
            <div className="approval-row" key={`${item.collection}-${item.id}`}>
              {renderRow(item)}
              <button aria-label="Approve" className="approve-text-button" type="button" onClick={() => approve(item)}>
                <Check size={16} /> Approve
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <div className="chip-row money-filters" role="tablist" aria-label="Filter">
        {FILTERS.filter((item) => !item.calculatedOnly || isCalculatedMonth).map((item) => (
          <button aria-selected={filter === item.id} className={filter === item.id ? "chip active" : "chip"} key={item.id} role="tab" type="button" onClick={() => setFilter(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <section className="panel feed">
        {groups.length ? (
          groups.map((group) => (
            <div className="feed-group" key={group.date}>
              <h4>{dayLabel(group.date)}</h4>
              {group.items.map(renderRow)}
            </div>
          ))
        ) : (
          <p className="empty">Nothing here yet. Tap Deposit or Pay merchant to add the first one.</p>
        )}
      </section>

      {openItem && !editing ? (
        <Sheet title={openInfo.title} onClose={() => setOpenItem(null)}>
          <div className="entry-detail">
            <div className={openItem.kind === "deposit" ? "entry-detail__amount is-credit" : "entry-detail__amount"}>
              {openItem.kind === "deposit" ? "+" : "−"}
              {formatTk(openItem.amount)}
            </div>
            <dl>
              <div>
                <dt>Date</dt>
                <dd>{formatDisplayDate(openItem.date)}</dd>
              </div>
              {openItem.kind === "deposit" ? (
                <div>
                  <dt>From</dt>
                  <dd>{nameOf(openItem.memberId)}</dd>
                </div>
              ) : null}
              {openItem.method ? (
                <div>
                  <dt>Paid by</dt>
                  <dd>{openItem.method}</dd>
                </div>
              ) : null}
              {openItem.note ? (
                <div>
                  <dt>Note</dt>
                  <dd>{openItem.note}</dd>
                </div>
              ) : null}
              <div>
                <dt>Status</dt>
                <dd className={openItem.status === "pending" ? "is-warn" : "is-credit"}>{openItem.status}</dd>
              </div>
              <div>
                <dt>Added by</dt>
                <dd>{openItem.createdByName || "Admin"}</dd>
              </div>
            </dl>
            <div className="entry-detail__actions">
              {isAdmin && openItem.status === "pending" ? (
                <button className="primary" type="button" onClick={() => approve(openItem)}>
                  <Check size={18} /> Approve
                </button>
              ) : null}
              {canEdit(openItem) ? (
                <button className="secondary" type="button" onClick={() => setEditing(true)}>
                  <Pencil size={18} /> Edit
                </button>
              ) : null}
              {canEdit(openItem) ? (
                <button className="danger-outline" type="button" onClick={() => setDeleteTarget(openItem)}>
                  <Trash2 size={18} /> Delete
                </button>
              ) : null}
            </div>
            {!canEdit(openItem) ? <p className="money-form__hint">Only an admin can change this.</p> : null}
          </div>
        </Sheet>
      ) : null}

      {openItem && editing ? (
        <Sheet title={MONEY_KINDS[moneyKindOf(openItem)].editTitle} onBack={() => setEditing(false)} onClose={() => {
          setEditing(false);
          setOpenItem(null);
        }}>
          <MoneyForm
            activeMembers={activeMembers}
            currentCycle={currentCycle}
            dueToMerchant={dueToMerchant}
            entry={openItem}
            isAdmin={isAdmin}
            kind={moneyKindOf(openItem)}
            member={member}
            setMessage={setMessage}
            onDone={() => {
              setEditing(false);
              setOpenItem(null);
            }}
          />
        </Sheet>
      ) : null}

      <ConfirmModal
        confirmLabel="Delete"
        message={deleteTarget ? `${describe(deleteTarget).title} · ${formatTk(deleteTarget.amount)} on ${formatDisplayDate(deleteTarget.date)} will be removed for good.` : ""}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          await deleteRecord(deleteTarget.collection, deleteTarget.id);
          trackEvent(`${deleteTarget.kind === "deposit" ? "deposit" : deleteTarget.kind === "merchant" ? "merchant_payment" : "expense"}_deleted`, { status: deleteTarget.status, amount: Number(deleteTarget.amount || 0) });
          setDeleteTarget(null);
          setOpenItem(null);
          setMessage("Deleted.");
        }}
        open={Boolean(deleteTarget)}
        title="Delete this entry?"
      />
    </div>
  );
}
