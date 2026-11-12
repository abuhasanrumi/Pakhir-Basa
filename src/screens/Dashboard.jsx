import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { CalendarCheck, ChevronRight, CircleDollarSign, ClipboardCheck, HandCoins, Moon, Plus, ShoppingBasket, Soup, Store, Sun, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { trackEvent } from "../analytics";
import { ConfirmModal } from "../components/ConfirmModal.jsx";
import { DateInput } from "../components/DateInput.jsx";
import { Metric } from "../components/Metric.jsx";
import { db } from "../firebase";
import { buildCycleSnapshot, getMealEntryRate, getMealRateMode, splitMeal, taka } from "../lib/calculations";
import { formatDisplayDate, formatTk, today } from "../lib/format";
import { buildMemberMealStats, groupMealsByDate } from "../lib/meals";

export function Dashboard({ activeMembers, currentCycle, expenses, isAdmin, isCalculatedMonth, ledger, mealEntries, member, members, onAdd, onOpenView, openMealSession, pendingCount, setActiveView, setCurrentCycle, setMobileSidebarOpen, setSelectedHistoryCycleId, setMessage, totals, deposits, messCash, settings }) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today());
  const approvedMeals = mealEntries.filter((entry) => entry.status === "approved");
  const memberMealStats = useMemo(() => buildMemberMealStats({ members: activeMembers, mealEntries: approvedMeals, settings, activeRate: totals.mealRate }), [activeMembers, approvedMeals, settings, totals.mealRate]);
  const mealsByDate = useMemo(() => groupMealsByDate(approvedMeals), [approvedMeals]);
  const myLedger = member ? ledger[member.id] : null;
  const myMealStats = member ? memberMealStats[member.id] : null;
  const myBalance = Number(myLedger?.balance || 0);
  const mealMerchantPaid = taka(
    expenses
      .filter((expense) => expense.status === "approved" && expense.category === "meal" && expense.payerId === "mess_cash")
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
  );
  const mealPaymentGap = taka(Number(totals.meals || 0) - mealMerchantPaid);
  const mealCostToPay = Math.max(0, mealPaymentGap);
  const mealPaymentDetail =
    mealPaymentGap < 0
      ? `Total ${formatTk(totals.meals)} · already paid ${formatTk(mealMerchantPaid)} · ${formatTk(Math.abs(mealPaymentGap))} extra`
      : `Total ${formatTk(totals.meals)} · already paid ${formatTk(mealMerchantPaid)}`;

  async function closeCycle() {
    const snapshot = buildCycleSnapshot({
      members: activeMembers,
      mealEntries,
      expenses: isCalculatedMonth ? expenses : [],
      deposits,
      settings
    });

    await updateDoc(doc(db, "cycles", currentCycle.id), {
      status: "closed",
      endDate: today(),
      closedAt: serverTimestamp(),
      snapshot,
    });

    setActiveView("history");
    setSelectedHistoryCycleId(currentCycle.id);
    setMobileSidebarOpen(false);
    setCurrentCycle(null);
    setConfirmClose(false);
    setMessage("Month closed. You can start the next one whenever you’re ready.");
    trackEvent("cycle_closed", {
      meal_rate_mode: getMealRateMode(settings),
      member_count: activeMembers.length,
      meal_count: totals.boxes,
      pending_count: pendingCount,
    });
  }

  return (
    <div className="stack">
      {member ? (
        <section className="personal-metrics" aria-label="Your meal and balance summary">
          <article className="personal-metric">
            <CalendarCheck size={22} />
            <div>
              <span>My meals</span>
              <strong>{Number(myMealStats?.meals || 0).toFixed(1)} meals</strong>
              <small>This month so far</small>
            </div>
          </article>
          <article className={myBalance < 0 ? "personal-metric due" : "personal-metric credit"}>
            <Wallet size={22} />
            <div>
              <span>My balance</span>
              <strong>{formatTk(Math.abs(myBalance))}</strong>
              <small>{myBalance < 0 ? "You need to pay" : "You have balance"}</small>
            </div>
          </article>
        </section>
      ) : null}

      <TodayCard mealEntries={mealEntries} onOpenSession={openMealSession} />

      {isAdmin && pendingCount > 0 ? (
        <button
          className="pending-banner"
          type="button"
          onClick={() => onOpenView(deposits.some((item) => item.status === "pending") || expenses.some((item) => item.status === "pending") ? "money" : "meals")}
        >
          <ClipboardCheck size={20} />
          <div>
            <strong>{pendingCount} waiting for your approval</strong>
            <span>Tap to review meals, deposits or payments.</span>
          </div>
          <ChevronRight size={18} />
        </button>
      ) : null}

      <div className="dashboard-section-title">
        <span>Mess summary</span>
      </div>

      <section className="metrics">
        <Metric
          label="Mess Cash"
          value={formatTk(messCash)}
          detail="Money currently in hand"
          icon={Wallet}
        />
        {isCalculatedMonth ? (
          <Metric
            label="Bazaar"
            value={formatTk(totals.bazaar)}
            detail="Food and grocery spending"
            icon={Soup}
          />
        ) : null}
        <Metric
          label="Total Mess Meals"
          value={`${totals.boxes} meals`}
          detail="Total ordered meals"
          icon={CalendarCheck}
        />
        <Metric
          label="Meal Rate"
          value={formatTk(totals.mealRate)}
          detail={getMealRateMode(settings) === "calculated" ? "Bazaar cost divided by meals" : "Rate used for saved meals"}
          icon={CircleDollarSign}
        />
        <Metric
          label="Meal Cost To Pay"
          value={formatTk(mealCostToPay)}
          detail={mealPaymentDetail}
          icon={CircleDollarSign}
        />
      </section>

      <section className="toolbar-band quick-actions" aria-label="Quick actions">
        <button className="primary" onClick={() => onAdd("deposit")}>
          <HandCoins size={18} /> Add deposit
        </button>
        {isCalculatedMonth ? (
          <button className="secondary" onClick={() => onAdd("bazaar")}>
            <ShoppingBasket size={18} /> Add bazaar
          </button>
        ) : null}
        <button className="secondary" onClick={() => onAdd("merchant")}>
          <Store size={18} /> Pay merchant
        </button>
        <button className="secondary" onClick={() => onOpenView("money")}>
          <Wallet size={18} /> All money
        </button>
      </section>

      <MemberSummaryTable isCalculatedMonth={isCalculatedMonth} ledger={ledger} members={members} mealStats={memberMealStats} />
      <MealCalendar activeMembers={activeMembers} mealsByDate={mealsByDate} selectedDate={selectedDate} setSelectedDate={setSelectedDate} settings={settings} activeRate={totals.mealRate} />
      {isAdmin ? (
        <section className="admin-danger-zone">
          <div>
            <span className="eyebrow">Careful action</span>
            <h2>Close this month</h2>
            <p>This locks the month and saves the final balances for everyone.</p>
          </div>
          <button className="danger close-cycle-button" onClick={() => {
            setConfirmClose(true);
            trackEvent("close_cycle_modal_opened", { meal_rate_mode: getMealRateMode(settings), pending_count: pendingCount });
          }}>
            Close month
          </button>
        </section>
      ) : null}
      <ConfirmModal
        confirmLabel="Close month"
        message="This will lock the current month and save the final report. After that, you can start a fresh month."
        onCancel={() => setConfirmClose(false)}
        onConfirm={closeCycle}
        open={confirmClose}
        requiredPhrase="close month"
        title="Close this month?"
      />
    </div>
  );
}

export function MemberSummaryTable({ isCalculatedMonth, ledger, mealStats, members }) {
  const rows = members.filter((member) => member.active).map((member) => ledger[member.id]).filter(Boolean);
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalDeposits += Number(row.deposits || 0);
      acc.totalMealShare += Number(row.mealCost || 0);
      acc.totalExpenseShare += Number(row.expenseCost || 0);
      acc.netBalance += Number(row.balance || 0);
      if (row.balance >= 0) acc.inCredit += 1;
      else acc.inDebt += 1;
      return acc;
    },
    { totalDeposits: 0, totalMealShare: 0, totalExpenseShare: 0, netBalance: 0, inCredit: 0, inDebt: 0 },
  );

  const totalMeals = rows.reduce((acc, row) => acc + Number(mealStats[row.memberId]?.meals || 0), 0);
  return (
    <section className="panel member-summary">
      <div className="section-heading member-summary__heading">
        <div>
          <span className="eyebrow">Everyone’s balance</span>
          <h2>Member summary</h2>
          <p>Meals, deposits, costs, and balance for each person.</p>
        </div>
        <div className="summary-note">
          <span>{rows.length} people</span>
          <span>{totalMeals.toFixed(1)} total meals</span>
        </div>
      </div>

      <ul className="balance-list" aria-label="Balance for each person">
        {rows.map((row) => (
          <li className="balance-row" key={row.memberId}>
            <span className="balance-row__avatar" aria-hidden="true">{row.name?.[0]?.toUpperCase() || "?"}</span>
            <div className="balance-row__who">
              <strong>{row.name}</strong>
              <span>
                {Number(mealStats[row.memberId]?.meals || 0).toFixed(1)} meals · paid {formatTk(row.deposits || 0)}
              </span>
            </div>
            <div className={row.balance >= 0 ? "balance-row__amount is-credit" : "balance-row__amount is-due"}>
              <strong>{formatTk(Math.abs(row.balance))}</strong>
              <span>{row.balance >= 0 ? "has balance" : "to pay"}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="table-wrap">
        <table className="summary-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Meal count</th>
              <th>Deposits</th>
              <th>Meal share</th>
              {isCalculatedMonth ? <th>Expense share</th> : null}
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.memberId}>
                <td>
                  <div className="member-cell">
                    <strong>{row.name}</strong>
                    <span>{row.balance >= 0 ? "Has balance" : "Needs to pay"}</span>
                  </div>
                </td>
                <td>{Number(mealStats[row.memberId]?.meals || 0).toFixed(1)}</td>
                <td>{formatTk(row.deposits || 0)}</td>
                <td>{formatTk(row.mealCost)}</td>
                {isCalculatedMonth ? <td>{formatTk(row.expenseCost)}</td> : null}
                <td className={row.balance >= 0 ? "positive" : "negative"}>{formatTk(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MealCalendar({ activeMembers, activeRate, mealsByDate, selectedDate, setSelectedDate, settings }) {
  const [detailDate, setDetailDate] = useState(null);
  const monthStart = new Date(`${selectedDate.slice(0, 7)}-01T00:00:00`);
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const leadingDays = monthStart.getDay();
  const cells = [
    ...Array.from({ length: leadingDays }, (_, index) => ({ blank: true, key: `blank-${index}` })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      const date = `${selectedDate.slice(0, 7)}-${day}`;
      return { date, day, entries: mealsByDate[date] || [] };
    }),
  ];
  const detailEntries = detailDate ? mealsByDate[detailDate] || [] : [];

  function openDateDetails(date) {
    setSelectedDate(date);
    setDetailDate(date);
    trackEvent("meal_calendar_date_opened", {
      has_meals: Boolean(mealsByDate[date]?.length),
      entry_count: mealsByDate[date]?.length || 0,
    });
  }

  return (
    <section className="panel meal-calendar-panel">
      <div className="section-heading">
        <h2>Meal calendar</h2>
        <p>Tap a date to see what happened that day.</p>
      </div>
      <div className="calendar-toolbar">
        <input type="month" value={selectedDate.slice(0, 7)} onChange={(event) => setSelectedDate(`${event.target.value}-01`)} />
        <DateInput label="Selected date" value={selectedDate} onChange={setSelectedDate} />
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <strong key={day}>{day}</strong>
        ))}
        {cells.map((cell) =>
          cell.blank ? (
            <span className="calendar-day blank" key={cell.key} />
          ) : (
            <CalendarDayButton key={cell.date} cell={cell} isSelected={cell.date === selectedDate} onClick={() => openDateDetails(cell.date)} />
          ),
        )}
      </div>
      {detailDate ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDetailDate(null)}>
          <div className="modal-card meal-details-modal" role="dialog" aria-modal="true" aria-labelledby="meal-details-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading meal-details-modal__heading">
              <span className="eyebrow">Daily meals</span>
              <h2 id="meal-details-title">Meals on {formatDisplayDate(detailDate)}</h2>
              <p>{detailEntries.length ? "Lunch and dinner split for this date." : "No meals were saved for this date."}</p>
            </div>
            <div className="meal-details-summary">
              <article className="meal-details-summary__item">
                <span>Total ordered</span>
                <strong>{detailEntries.reduce((sum, entry) => sum + Number(entry.boxCount || 0), 0)}</strong>
              </article>
              <article className="meal-details-summary__item">
                <span>Meal rate</span>
                <strong>{formatTk(activeRate)}</strong>
              </article>
            </div>
            <div className="daily-details">
              {detailEntries.map((entry) => {
                const rate = getMealRateMode(settings) === "calculated" ? activeRate : getMealEntryRate(entry, settings);
                const shares = splitMeal(entry, rate);
                const totalShare = Object.values(shares).reduce((sum, amount) => sum + Number(amount || 0), 0);
                return (
                  <article className="daily-meal-card" key={entry.id}>
                    <div className="daily-meal-card__top">
                      <div className="daily-meal-card__session">
                        <span>{entry.session}</span>
                        <strong>{entry.boxCount} ordered</strong>
                        <small>Submitted by {entry.submittedByName || entry.createdByName || "Admin"}</small>
                      </div>
                      <div className="daily-meal-card__rate">
                        <span>{formatTk(rate)} rate</span>
                      </div>
                    </div>
                    <div className="daily-meal-card__chips">
                      {Object.entries(shares).map(([memberId, amount]) => (
                        <span key={memberId} className="meal-share-chip">
                          {activeMembers.find((person) => person.id === memberId)?.name || memberId}: {formatTk(amount)}
                        </span>
                      ))}
                    </div>
                    <div className="daily-meal-card__footer">
                      <small>{Object.keys(shares).length} person{Object.keys(shares).length === 1 ? "" : "s"} ate this meal</small>
                      <strong>{formatTk(totalShare)}</strong>
                    </div>
                  </article>
                );
              })}
              {!detailEntries.length ? <p className="empty">No meals for this date.</p> : null}
            </div>
            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => setDetailDate(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function CalendarDayButton({ cell, isSelected, onClick }) {
  const orderedMeals = taka(cell.entries.reduce((sum, entry) => sum + Number(entry.boxCount || 0), 0));
  return (
    <button
      aria-label={`${Number(cell.day)}: ${orderedMeals ? `${orderedMeals} meal${orderedMeals === 1 ? "" : "s"}` : "no meals"}`}
      className={`calendar-day${isSelected ? " selected" : ""}${orderedMeals ? " has-meals" : ""}${cell.date === today() ? " is-today" : ""}`}
      type="button"
      onClick={onClick}
    >
      <span>{Number(cell.day)}</span>
      {orderedMeals ? <b className="calendar-day__count">{Math.round(orderedMeals * 10) / 10}</b> : null}
    </button>
  );
}

function sessionSummary(entries, session) {
  const entry = entries.find((item) => item.session === session);
  if (!entry) return { label: "Not added", detail: "", state: "empty" };
  const count = taka(Number(entry.boxCount || 0));
  const people = entry.eaters?.length || 0;
  return {
    label: `${count} meal${count === 1 ? "" : "s"}`,
    detail: `${people} ${people === 1 ? "person" : "people"}${entry.status === "pending" ? " · pending" : ""}`,
    state: entry.status === "pending" ? "pending" : "done",
  };
}

// At-a-glance status for today's lunch and dinner, with a shortcut to the meal sheet.
function TodayCard({ mealEntries, onOpenSession }) {
  const date = today();
  const todaysEntries = mealEntries.filter((entry) => entry.date === date);
  const lunch = sessionSummary(todaysEntries, "lunch");
  const dinner = sessionSummary(todaysEntries, "dinner");

  return (
    <section className="today-card" aria-label="Today's meals">
      <div className="today-card__head">
        <div>
          <span className="eyebrow">Today</span>
          <h2>{formatDisplayDate(date)}</h2>
        </div>
      </div>
      <div className="today-card__sessions">
        {[
          ["lunch", "Lunch", Sun, lunch],
          ["dinner", "Dinner", Moon, dinner],
        ].map(([key, label, Icon, info]) => (
          <button className={`today-session today-session--${info.state}`} key={key} type="button" onClick={() => onOpenSession(key)}>
            <span className="today-session__top">
              <Icon size={18} />
              <span>{label}</span>
              {info.state === "empty" ? <Plus className="today-session__go" size={18} /> : <ChevronRight className="today-session__go" size={18} />}
            </span>
            <strong>{info.label}</strong>
            <small>{info.detail || (info.state === "empty" ? `Tap to add` : "\u00a0")}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
