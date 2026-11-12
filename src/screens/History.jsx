import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, Moon, Share2, Sun, Users, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { trackEvent } from "../analytics";
import { copyToClipboard } from "../lib/actions";
import { taka } from "../lib/calculations";
import { formatDisplayDate, formatTk } from "../lib/format";

// Everything the month list and the month report need, worked out once from a closed
// month's saved snapshot.
function summarizeCycle(cycle) {
  const snapshot = cycle.snapshot || {};
  const totals = snapshot.totals || {};
  const meals = snapshot.meals || [];
  const ledger = Object.values(snapshot.ledger || {});
  const isCalculated = totals.mealRateMode === "calculated";
  const totalMeals = taka(meals.reduce((sum, entry) => sum + Number(entry.boxCount || 0), 0));
  const mealCost = Number(totals.meals || 0);
  const mealRate = totalMeals > 0 ? mealCost / totalMeals : Number(totals.calculatedMealRate || totals.defaultMealRate || 0);
  const toCollect = taka(ledger.filter((row) => row.balance < 0).reduce((sum, row) => sum + Math.abs(Number(row.balance || 0)), 0));
  const toReturn = taka(ledger.filter((row) => row.balance > 0).reduce((sum, row) => sum + Number(row.balance || 0), 0));

  return {
    deposits: Number(totals.deposits || 0),
    expenses: Number(totals.expenses || 0),
    isCalculated,
    ledger,
    mealCost,
    mealRate,
    people: ledger.length,
    toCollect,
    toReturn,
    totalMeals,
  };
}

function monthTitle(cycle) {
  return cycle.name || formatDisplayDate(cycle.startDate);
}

function monthRange(cycle) {
  return `${formatDisplayDate(cycle.startDate)} – ${cycle.endDate ? formatDisplayDate(cycle.endDate) : "closed"}`;
}

export function History({ cycles, onSelectCycle, selectedCycleId }) {
  const closed = cycles
    .filter((cycle) => cycle.status === "closed")
    .sort((left, right) => String(right.startDate || "").localeCompare(String(left.startDate || "")));
  const selectedCycle = closed.find((cycle) => cycle.id === selectedCycleId) || null;

  if (selectedCycle) {
    return <MonthReport cycle={selectedCycle} onBack={() => onSelectCycle?.("")} />;
  }

  return (
    <section className="history-list" aria-label="Closed months">
      {closed.length ? (
        closed.map((cycle) => {
          const summary = summarizeCycle(cycle);
          return (
            <button
              className="history-card"
              key={cycle.id}
              type="button"
              onClick={() => {
                onSelectCycle?.(cycle.id);
                window.scrollTo({ top: 0 });
                trackEvent("history_month_opened", { people: summary.people });
              }}
            >
              <div className="history-card__head">
                <div>
                  <strong>{monthTitle(cycle)}</strong>
                  <span>{monthRange(cycle)}</span>
                </div>
                <ChevronRight size={20} />
              </div>
              <div className="history-card__stats">
                <span>
                  <em>Meal rate</em>
                  {formatTk(summary.mealRate)}
                </span>
                <span>
                  <em>Meals</em>
                  {summary.totalMeals}
                </span>
                <span>
                  <em>Meal cost</em>
                  {formatTk(summary.mealCost)}
                </span>
              </div>
              <div className="history-card__foot">
                <span>
                  <Users size={14} /> {summary.people} people
                </span>
                {summary.toCollect > 0 ? <span className="is-due">{formatTk(summary.toCollect)} to collect</span> : <span className="is-credit">All settled</span>}
              </div>
            </button>
          );
        })
      ) : (
        <div className="panel history-empty">
          <CalendarDays size={28} />
          <strong>No closed months yet</strong>
          <p>When an admin closes a month, its final report shows up here.</p>
        </div>
      )}
    </section>
  );
}

const REPORT_TABS = [
  { id: "people", label: "People", icon: Users },
  { id: "days", label: "Days", icon: CalendarDays },
  { id: "money", label: "Money", icon: Wallet },
];

function MonthReport({ cycle, onBack }) {
  const [tab, setTab] = useState("people");
  const [shareStatus, setShareStatus] = useState("");
  const summary = useMemo(() => summarizeCycle(cycle), [cycle]);
  const nameOf = (memberId) => summary.ledger.find((row) => row.memberId === memberId)?.name || "Unknown";

  async function shareReport() {
    const lines = [
      `${monthTitle(cycle)} (${monthRange(cycle)})`,
      `Meal rate ${formatTk(summary.mealRate)} · ${summary.totalMeals} meals · meal cost ${formatTk(summary.mealCost)}`,
      "",
      ...[...summary.ledger]
        .sort((left, right) => Number(left.balance || 0) - Number(right.balance || 0))
        .map((row) => {
          const balance = Number(row.balance || 0);
          const status = balance < 0 ? `owes ${formatTk(Math.abs(balance))}` : balance > 0 ? `gets back ${formatTk(balance)}` : "settled";
          return `${row.name}: ${Number(row.mealCount || 0).toFixed(1)} meals, paid ${formatTk(row.deposits || 0)}, ${status}`;
        }),
    ];
    const text = lines.join("\n");

    try {
      if (navigator.share) {
        await navigator.share({ title: monthTitle(cycle), text });
        trackEvent("history_report_shared", { method: "share_sheet" });
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
    const copied = await copyToClipboard(text);
    setShareStatus(copied ? "Copied. Paste it in your group chat." : "Couldn’t copy on this device.");
    trackEvent("history_report_shared", { method: copied ? "clipboard" : "failed" });
    window.setTimeout(() => setShareStatus(""), 4000);
  }

  return (
    <div className="month-report">
      <div className="month-report__bar">
        <button className="secondary month-report__back" type="button" onClick={onBack}>
          <ArrowLeft size={18} /> All months
        </button>
        <button className="secondary" type="button" onClick={shareReport}>
          <Share2 size={18} /> Share
        </button>
      </div>
      {shareStatus ? <div className="notice">{shareStatus}</div> : null}

      <section className="month-report__hero">
        <span className="eyebrow">Closed month</span>
        <h2>{monthTitle(cycle)}</h2>
        <p>{monthRange(cycle)}</p>
        <div className="month-report__rate">
          <span>Meal rate</span>
          <strong>{formatTk(summary.mealRate)}</strong>
          <small>{summary.isCalculated ? "Bazaar cost ÷ meals" : "Fixed rate"}</small>
        </div>
      </section>

      <section className="month-report__stats">
        <article>
          <span>Total meals</span>
          <strong>{summary.totalMeals}</strong>
        </article>
        <article>
          <span>Meal cost</span>
          <strong>{formatTk(summary.mealCost)}</strong>
        </article>
        <article>
          <span>Deposits</span>
          <strong>{formatTk(summary.deposits)}</strong>
        </article>
        <article>
          <span>To collect</span>
          <strong className={summary.toCollect > 0 ? "is-due" : ""}>{formatTk(summary.toCollect)}</strong>
        </article>
        {summary.toReturn > 0 ? (
          <article>
            <span>To give back</span>
            <strong className="is-credit">{formatTk(summary.toReturn)}</strong>
          </article>
        ) : null}
        {summary.isCalculated ? (
          <article>
            <span>Bazaar & costs</span>
            <strong>{formatTk(summary.expenses)}</strong>
          </article>
        ) : null}
      </section>

      <div className="report-tabs" role="tablist" aria-label="Report section">
        {REPORT_TABS.map(({ id, label, icon: Icon }) => (
          <button aria-selected={tab === id} className={tab === id ? "report-tab active" : "report-tab"} key={id} role="tab" type="button" onClick={() => setTab(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab === "people" ? <PeopleTab summary={summary} /> : null}
      {tab === "days" ? <DaysTab cycle={cycle} summary={summary} /> : null}
      {tab === "money" ? <MoneyTab cycle={cycle} nameOf={nameOf} /> : null}
    </div>
  );
}

function PeopleTab({ summary }) {
  const [openId, setOpenId] = useState("");
  const rows = [...summary.ledger].sort((left, right) => Number(left.balance || 0) - Number(right.balance || 0));

  if (!rows.length) return <p className="empty">No one was in this month.</p>;

  return (
    <section className="panel report-list">
      {rows.map((row) => {
        const balance = Number(row.balance || 0);
        const isOpen = openId === row.memberId;
        return (
          <div className="settle-row" key={row.memberId}>
            <button aria-expanded={isOpen} className="settle-row__main" type="button" onClick={() => setOpenId(isOpen ? "" : row.memberId)}>
              <span className="balance-row__avatar" aria-hidden="true">{row.name?.[0]?.toUpperCase() || "?"}</span>
              <span className="settle-row__who">
                <strong>{row.name}</strong>
                <small>
                  {Number(row.mealCount || 0).toFixed(1)} meals · paid {formatTk(row.deposits || 0)}
                </small>
              </span>
              <span className={balance < 0 ? "settle-row__amount is-due" : balance > 0 ? "settle-row__amount is-credit" : "settle-row__amount"}>
                <strong>{formatTk(Math.abs(balance))}</strong>
                <small>{balance < 0 ? "owes" : balance > 0 ? "gets back" : "settled"}</small>
              </span>
              <ChevronDown className={isOpen ? "settle-row__chevron open" : "settle-row__chevron"} size={18} />
            </button>
            {isOpen ? (
              <dl className="settle-row__detail">
                <div>
                  <dt>Meals eaten</dt>
                  <dd>{Number(row.mealCount || 0).toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Meal cost</dt>
                  <dd>{formatTk(row.mealCost || 0)}</dd>
                </div>
                {Number(row.expenseCost || 0) > 0 ? (
                  <div>
                    <dt>Other costs</dt>
                    <dd>{formatTk(row.expenseCost)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Paid in</dt>
                  <dd>{formatTk(row.deposits || 0)}</dd>
                </div>
                <div className="settle-row__total">
                  <dt>{balance < 0 ? "Still owes" : balance > 0 ? "Gets back" : "Balance"}</dt>
                  <dd>{formatTk(Math.abs(balance))}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        );
      })}
      <div className="report-list__total">
        <span>Total meal cost</span>
        <strong>{formatTk(summary.mealCost)}</strong>
      </div>
    </section>
  );
}

function DaysTab({ cycle, summary }) {
  const days = useMemo(() => {
    const byDate = {};
    (cycle.snapshot?.meals || []).forEach((entry) => {
      const day = byDate[entry.date] || { date: entry.date, lunch: 0, dinner: 0, cost: 0 };
      const count = Number(entry.boxCount || 0);
      const rate = summary.isCalculated ? summary.mealRate : Number(entry.rate || summary.mealRate || 0);
      if (entry.session === "dinner") day.dinner = taka(day.dinner + count);
      else day.lunch = taka(day.lunch + count);
      day.cost = taka(day.cost + count * rate);
      byDate[entry.date] = day;
    });
    return Object.values(byDate).sort((left, right) => String(left.date).localeCompare(String(right.date)));
  }, [cycle, summary]);

  if (!days.length) return <p className="empty">No meals were saved in this month.</p>;

  return (
    <section className="panel report-list">
      <div className="day-row day-row--head" aria-hidden="true">
        <span>Date</span>
        <span>
          <Sun size={14} />
        </span>
        <span>
          <Moon size={14} />
        </span>
        <span>Cost</span>
      </div>
      {days.map((day) => (
        <div className="day-row" key={day.date}>
          <span className="day-row__date">{formatDisplayDate(day.date).replace(/,? \d{4}$/, "")}</span>
          <span>{day.lunch || "–"}</span>
          <span>{day.dinner || "–"}</span>
          <span className="day-row__cost">{formatTk(day.cost)}</span>
        </div>
      ))}
      <div className="report-list__total">
        <span>{summary.totalMeals} meals over {days.length} days</span>
        <strong>{formatTk(summary.mealCost)}</strong>
      </div>
    </section>
  );
}

function MoneyTab({ cycle, nameOf }) {
  const deposits = [...(cycle.snapshot?.deposits || [])].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const expenses = [...(cycle.snapshot?.expenses || [])].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const depositTotal = taka(deposits.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const expenseTotal = taka(expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0));

  return (
    <div className="stack">
      <section className="panel report-list">
        <h3 className="report-list__title">Deposits</h3>
        {deposits.length ? (
          deposits.map((item) => (
            <div className="money-row" key={item.id}>
              <span className="money-row__who">
                <strong>{nameOf(item.memberId)}</strong>
                <small>
                  {formatDisplayDate(item.date)}
                  {item.note ? ` · ${item.note}` : ""}
                </small>
              </span>
              <strong className="is-credit">{formatTk(item.amount)}</strong>
            </div>
          ))
        ) : (
          <p className="empty">No deposits this month.</p>
        )}
        <div className="report-list__total">
          <span>Total deposits</span>
          <strong>{formatTk(depositTotal)}</strong>
        </div>
      </section>

      {expenses.length ? (
        <section className="panel report-list">
          <h3 className="report-list__title">Bazaar and costs</h3>
          {expenses.map((item) => (
            <div className="money-row" key={item.id}>
              <span className="money-row__who">
                <strong>{item.title || item.category}</strong>
                <small>
                  {formatDisplayDate(item.date)} · {item.category}
                </small>
              </span>
              <strong>{formatTk(item.amount)}</strong>
            </div>
          ))}
          <div className="report-list__total">
            <span>Total spent</span>
            <strong>{formatTk(expenseTotal)}</strong>
          </div>
        </section>
      ) : null}
    </div>
  );
}
