import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import {
  Banknote,
  CalendarCheck,
  Check,
  CircleDollarSign,
  LogOut,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Shield,
  Soup,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  addRecord,
  auth,
  bootstrapAdmin,
  db,
  deleteRecord,
  getMemberByEmail,
  getOpenCycle,
  hasFirebaseConfig,
  initialAdminEmail,
  setRecord,
  signInWithGoogle,
  signOutUser,
  updateRecord,
} from "./firebase";
import { buildCycleSnapshot, calculateLedger, getCalculatedMealRate, getMealEntryRate, getMealRateMode, splitMeal, taka } from "./lib/calculations";

const today = () => new Date().toISOString().slice(0, 10);

const emptyExpense = {
  date: today(),
  title: "Bazaar",
  category: "bazaar",
  amount: "",
  payerId: "",
  splitMethod: "equal",
  participants: [],
  customShares: {},
};

function formatTk(amount) {
  return `৳${taka(amount).toLocaleString("en-BD", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function isBeforeDate(date, minDate) {
  return Boolean(date && minDate && date < minDate);
}

function flattenDailyMeals(dailyMeals = []) {
  return dailyMeals.flatMap((day) =>
    ["lunch", "dinner"].flatMap((session) => {
      const meal = day[session];
      if (!meal || Number(meal.boxCount || 0) <= 0 || !meal.eaters?.length) return [];

      return [{
        id: `${day.id}-${session}`,
        dailyMealId: day.id,
        cycleId: day.cycleId,
        date: day.date,
        session,
        boxCount: Number(meal.boxCount || 0),
        rate: Number(meal.rate || day.mealRate || 70),
        rateMode: day.rateMode,
        eaters: meal.eaters || [],
        portions: meal.portions || {},
        status: day.status || "approved",
        createdBy: day.createdBy,
        createdByName: day.createdByName,
      }];
    }),
  );
}

function useCollection(collectionName, options = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db || options.skip) {
      setRows([]);
      setLoading(false);
      return undefined;
    }

    const clauses = [];
    if (options.cycleId) clauses.push(where("cycleId", "==", options.cycleId));
    if (options.orderBy && !options.cycleId) clauses.push(orderBy(options.orderBy, options.orderDirection || "asc"));
    const q = clauses.length ? query(collection(db, collectionName), ...clauses) : collection(db, collectionName);

    return onSnapshot(
      q,
      (snap) => {
        const nextRows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
        if (options.orderBy && options.cycleId) {
          nextRows.sort((a, b) => {
            const left = a[options.orderBy] || "";
            const right = b[options.orderBy] || "";
            return options.orderDirection === "desc" ? String(right).localeCompare(String(left)) : String(left).localeCompare(String(right));
          });
        }
        setRows(nextRows);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [collectionName, options.cycleId, options.orderBy, options.orderDirection, options.skip]);

  return { rows, loading };
}

export function App() {
  const [user, setUser] = useState(null);
  const [member, setMember] = useState(null);
  const [currentCycle, setCurrentCycle] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!auth) {
      setBootstrapping(false);
      return undefined;
    }

    return onAuthStateChanged(auth, async (nextUser) => {
      try {
        setUser(nextUser);
        setMember(null);
        setCurrentCycle(null);
        setBootstrapping(true);
        setMessage("");

        if (!nextUser?.email) {
          setBootstrapping(false);
          return;
        }

        const email = nextUser.email.toLowerCase();
        let appMember = await getMemberByEmail(email);
        if (!appMember && initialAdminEmail && email === initialAdminEmail) {
          appMember = await bootstrapAdmin(nextUser);
        }

        if (appMember?.active) {
          setMember(appMember);
          setCurrentCycle(await getOpenCycle());
        }

        setBootstrapping(false);
      } catch (error) {
        console.error("Firebase setup failed", error);
        setMessage(error.code === "permission-denied" ? "Firestore permission denied. Deploy the latest firestore.rules, then sign in again." : error.message);
        setBootstrapping(false);
      }
    });
  }, []);

  const isAdmin = member?.role === "admin";
  const { rows: members } = useCollection("members", { orderBy: "name", skip: !member });
  const { rows: cycles } = useCollection("cycles", { orderBy: "startDate", orderDirection: "desc", skip: !member });
  useEffect(() => {
    const openCycle = cycles.find((cycle) => cycle.status === "open");
    setCurrentCycle(openCycle || null);
  }, [cycles]);

  const { rows: dailyMeals } = useCollection("dailyMeals", { cycleId: currentCycle?.id, orderBy: "date", skip: !currentCycle });
  const mealEntries = useMemo(() => flattenDailyMeals(dailyMeals), [dailyMeals]);
  const { rows: expenses } = useCollection("expenses", { cycleId: currentCycle?.id, orderBy: "date", skip: !currentCycle });
  const { rows: deposits } = useCollection("deposits", { cycleId: currentCycle?.id, orderBy: "date", skip: !currentCycle });
  const { rows: settingsRows } = useCollection("settings", { skip: !member });
  const settingsDoc = settingsRows[0] || {};
  const settings = {
    id: settingsDoc.id,
    mealRate: currentCycle?.mealRate ?? settingsDoc.mealRate ?? 70,
    mealRateMode: currentCycle?.mealRateMode || settingsDoc.mealRateMode || settingsDoc.mealRateMethod || "static",
  };
  const activeMembers = members.filter((item) => item.active);
  const isCalculatedMonth = getMealRateMode(settings) === "calculated";

  useEffect(() => {
    if (!isCalculatedMonth && activeView === "expenses") {
      setActiveView("dashboard");
    }
  }, [activeView, isCalculatedMonth]);

  const ledger = useMemo(
    () => calculateLedger({ members: activeMembers, mealEntries, expenses: isCalculatedMonth ? expenses : [], deposits, settings }),
    [activeMembers, mealEntries, expenses, deposits, settings, isCalculatedMonth],
  );

  const pendingCount = useMemo(
    () => dailyMeals.filter((entry) => entry.status === "pending").length +
      (isCalculatedMonth ? expenses.filter((expense) => expense.status === "pending").length : 0) +
      deposits.filter((d) => d.status === "pending").length,
    [dailyMeals, expenses, deposits, isCalculatedMonth],
  );

  const totals = useMemo(() => {
    const approvedMeals = mealEntries.filter((entry) => entry.status === "approved");
    const approvedExpenses = isCalculatedMonth ? expenses.filter((expense) => expense.status === "approved") : [];
    const mealRateMode = getMealRateMode(settings);

    const approvedBazaar = approvedExpenses.filter((e) => e.category === "bazaar");
    const totalBazaar = approvedBazaar.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const totalBoxes = approvedMeals.reduce((sum, entry) => sum + Number(entry.boxCount || 0), 0);
    const calculatedRate = getCalculatedMealRate({ mealEntries, expenses, settings });
    const mealTotal = approvedMeals.reduce((sum, entry) => {
      const rate = mealRateMode === "calculated" ? calculatedRate : getMealEntryRate(entry, settings);
      return sum + Number(entry.boxCount || 0) * rate;
    }, 0);
    const activeRate = totalBoxes > 0 ? mealTotal / totalBoxes : mealRateMode === "calculated" ? calculatedRate : Number(settings.mealRate) || 70;

    return {
      meals: taka(mealTotal),
      expenses: taka(approvedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)),
      bazaar: taka(totalBazaar),
      boxes: taka(totalBoxes),
      mealRate: activeRate,
    };
  }, [mealEntries, expenses, settings, isCalculatedMonth]);

  const messCash = useMemo(() => {
    const approvedDeposits = deposits.filter((d) => d.status === "approved");
    const totalDeposits = approvedDeposits.reduce((sum, d) => sum + Number(d.amount || 0), 0);

    const approvedMessBazaars = isCalculatedMonth ? expenses.filter((e) => e.status === "approved" && e.payerId === "mess_cash") : [];
    const totalMessBazaars = approvedMessBazaars.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    return taka(totalDeposits - totalMessBazaars);
  }, [deposits, expenses, isCalculatedMonth]);

  if (!hasFirebaseConfig) return <SetupScreen />;
  if (bootstrapping) return <Shell message="Loading household data..." />;
  if (!user) return <LoginScreen />;
  if (message && !member) return <SetupError message={message} />;
  if (!member) return <AccessBlocked user={user} />;
  if (!currentCycle) {
    return (
      <NoCycleScreen
        isAdmin={isAdmin}
        member={member}
        setCurrentCycle={setCurrentCycle}
        setMessage={setMessage}
        user={user}
      />
    );
  }

  const navigation = [
    { id: "dashboard", label: "Dashboard", icon: CalendarCheck },
    { id: "meals", label: "Meals", icon: Soup },
    { id: "expenses", label: "Expenses", icon: ReceiptText, calculatedOnly: true },
    { id: "deposits", label: "Deposits", icon: Wallet },
    { id: "members", label: "Members", icon: Users, adminOnly: true },
    { id: "history", label: "Cycle History", icon: Banknote },
  ].filter((item) => (!item.adminOnly || isAdmin) && (!item.calculatedOnly || isCalculatedMonth));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">PB</div>
          <div>
            <strong>Pakhir Basa</strong>
            <span>Meal & Mess Tracker</span>
          </div>
        </div>

        <nav className="nav">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button className={activeView === item.id ? "nav-item active" : "nav-item"} key={item.id} onClick={() => setActiveView(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === "dashboard" && pendingCount > 0 ? <b>{pendingCount}</b> : null}
              </button>
            );
          })}
        </nav>

        <div className="profile">
          <img src={user.photoURL} alt="" />
          <div>
            <strong>{member.name}</strong>
            <span>{member.role}</span>
          </div>
          <button className="icon-button" title="Sign out" onClick={signOutUser}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p>{currentCycle?.name || "Current Cycle"}</p>
            <h1>{navigation.find((item) => item.id === activeView)?.label || "Dashboard"}</h1>
          </div>
          <div className="top-actions">
            <span className="status-pill">
              {getMealRateMode(settings) === "calculated" ? "Calculated month: " : "Static month: "}
              {formatTk(totals.mealRate)}
            </span>
          </div>
        </header>

        {message ? <div className="notice">{message}</div> : null}

        {activeView === "dashboard" ? (
          <Dashboard
            activeMembers={activeMembers}
            currentCycle={currentCycle}
            expenses={expenses}
            isCalculatedMonth={isCalculatedMonth}
            isAdmin={isAdmin}
            ledger={ledger}
            mealEntries={mealEntries}
            members={members}
            pendingCount={pendingCount}
            setActiveView={setActiveView}
            setCurrentCycle={setCurrentCycle}
            setMessage={setMessage}
            totals={totals}
            deposits={deposits}
            messCash={messCash}
            settings={settings}
          />
        ) : null}
        {activeView === "meals" ? (
          <Meals
            activeMembers={activeMembers}
            currentCycle={currentCycle}
            dailyMeals={dailyMeals}
            expenses={expenses}
            isAdmin={isAdmin}
            mealEntries={mealEntries}
            member={member}
            settings={settings}
            setMessage={setMessage}
          />
        ) : null}
        {activeView === "expenses" && isCalculatedMonth ? (
          <Expenses
            currentCycle={currentCycle}
            expenses={expenses}
            isAdmin={isAdmin}
            member={member}
            setMessage={setMessage}
          />
        ) : null}
        {activeView === "deposits" ? (
          <Deposits
            activeMembers={activeMembers}
            currentCycle={currentCycle}
            deposits={deposits}
            isAdmin={isAdmin}
            member={member}
            setMessage={setMessage}
          />
        ) : null}
        {activeView === "members" && isAdmin ? <Members members={members} setMessage={setMessage} /> : null}
        {activeView === "history" ? <History cycles={cycles} /> : null}
      </main>
    </div>
  );
}

function SetupError({ message }) {
  return (
    <div className="center-screen setup">
      <Shield size={42} />
      <h1>Setup needs attention</h1>
      <p>{message}</p>
      <button className="secondary" onClick={signOutUser}>
        Sign out
      </button>
    </div>
  );
}

function Shell({ message }) {
  return (
    <div className="center-screen">
      <div className="loader" />
      <p>{message}</p>
    </div>
  );
}

function SetupScreen() {
  return (
    <div className="center-screen setup">
      <Shield size={42} />
      <h1>Firebase config needed</h1>
      <p>Create a Firebase web app, copy `.env.example` to `.env`, fill the `VITE_FIREBASE_*` values, then restart the dev server.</p>
    </div>
  );
}

function LoginScreen() {
  return (
    <div className="login-screen">
      <section className="login-hero">
        <div>
          <p>Shared house ledger</p>
          <h1>Pakhir Basa'r Meal Tracker</h1>
          <span>Track lunch, dinner, bazaar costs, deposits, and cycle closing from one clean workspace.</span>
        </div>
      </section>
      <section className="login-panel">
        <Soup size={36} />
        <h2>Sign in with Gmail</h2>
        <p>The first signed-in Gmail becomes the admin. After that, only invited active members can enter.</p>
        <button className="primary" onClick={signInWithGoogle}>
          Continue with Google
        </button>
      </section>
    </div>
  );
}

function AccessBlocked({ user }) {
  return (
    <div className="center-screen setup">
      <Shield size={42} />
      <h1>Access not enabled</h1>
      <p>{user.email} is not in this household member list yet. Ask an admin to add this Gmail address.</p>
      <button className="secondary" onClick={signOutUser}>
        Sign out
      </button>
    </div>
  );
}

function NoCycleScreen({ isAdmin, member, setCurrentCycle, setMessage, user }) {
  const [form, setForm] = useState({
    name: new Date().toLocaleString("en", { month: "long", year: "numeric" }),
    startDate: today(),
    rateMode: "static",
    mealRate: 70,
  });

  async function startCycle(event) {
    event.preventDefault();
    const cycle = {
      name: form.name || "Current Month",
      status: "open",
      startDate: form.startDate,
      mealRateMode: form.rateMode,
      mealRate: Number(form.mealRate) || 70,
      createdBy: member.id,
    };
    const ref = await addRecord("cycles", cycle);
    await setDoc(
      doc(db, "settings", "main"),
      {
        mealRate: cycle.mealRate,
        mealRateMode: cycle.mealRateMode,
        mealRateMethod: cycle.mealRateMode,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setCurrentCycle({ id: ref.id, ...cycle });
    setMessage("New month started.");
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">PB</div>
          <div>
            <strong>Pakhir Basar</strong>
            <span>Meal & Mess Tracker</span>
          </div>
        </div>
        <div className="profile">
          <img src={user.photoURL} alt="" />
          <div>
            <strong>{member.name}</strong>
            <span>{member.role}</span>
          </div>
          <button className="icon-button" title="Sign out" onClick={signOutUser}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main no-cycle-main">
        <section className="panel no-cycle-panel">
          <div className="section-heading">
            <h2>No active month</h2>
            <p>{isAdmin ? "Create a month and choose how meal cost will be calculated." : "An admin needs to create the current month before entries can be added."}</p>
          </div>
          {isAdmin ? (
            <form className="form-grid" onSubmit={startCycle}>
              <label>
                Month name
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label>
                Start date
                <input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
              </label>
              <label>
                Meal rate mode
                <select value={form.rateMode} onChange={(event) => setForm({ ...form, rateMode: event.target.value })}>
                  <option value="static">Static meal rate</option>
                  <option value="calculated">Calculated from expense and deposits</option>
                </select>
              </label>
              <label>
                Default meal rate
                <input min="1" type="number" value={form.mealRate} onChange={(event) => setForm({ ...form, mealRate: event.target.value })} />
              </label>
              <button className="primary" type="submit">
                <Plus size={18} /> Create month
              </button>
            </form>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function Dashboard({ activeMembers, currentCycle, expenses, isAdmin, isCalculatedMonth, ledger, mealEntries, members, pendingCount, setActiveView, setCurrentCycle, setMessage, totals, deposits, messCash, settings }) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today());
  const approvedMeals = mealEntries.filter((entry) => entry.status === "approved");
  const memberMealStats = useMemo(() => buildMemberMealStats({ members: activeMembers, mealEntries: approvedMeals, settings, activeRate: totals.mealRate }), [activeMembers, approvedMeals, settings, totals.mealRate]);
  const mealsByDate = useMemo(() => groupMealsByDate(approvedMeals), [approvedMeals]);

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

    setCurrentCycle(null);
    setConfirmClose(false);
    setMessage("Cycle closed. Admin can create the next month when ready.");
  }

  return (
    <div className="stack">
      <section className="metrics">
        <Metric
          label="Mess Cash Fund"
          value={formatTk(messCash)}
          detail="Advances in Mess Wallet"
          icon={Wallet}
        />
        {isCalculatedMonth ? (
          <Metric
            label="Groceries (Bazaar)"
            value={formatTk(totals.bazaar)}
            detail="Total spent on food bazaar"
            icon={Soup}
          />
        ) : null}
        <Metric
          label="Meals Eaten"
          value={`${totals.boxes} meals`}
          detail="Total boxes consumed"
          icon={CalendarCheck}
        />
        <Metric
          label="Running Meal Rate"
          value={formatTk(totals.mealRate)}
          detail={getMealRateMode(settings) === "calculated" ? "Bazaar/meal expenses divided by meals" : "Weighted by approved meal entries"}
          icon={CircleDollarSign}
        />
        <Metric
          label="Total Meal Cost"
          value={formatTk(totals.meals)}
          detail={getMealRateMode(settings) === "calculated" ? "Bazaar/meal expenses divided by meals" : "Approved meal entries at their recorded rates"}
          icon={CircleDollarSign}
        />
      </section>

      <section className="toolbar-band">
        <button className="primary" onClick={() => setActiveView("meals")}>
          <Plus size={18} /> Add meal
        </button>
        {isCalculatedMonth ? (
          <button className="secondary" onClick={() => setActiveView("expenses")}>
            <Plus size={18} /> Add expense
          </button>
        ) : null}
        <button className="secondary" onClick={() => setActiveView("deposits")}>
          <Plus size={18} /> Deposit / Advance
        </button>
        {isAdmin ? (
          <button
            className="danger"
            onClick={() => setConfirmClose(true)}
          >
            Close current cycle
          </button>
        ) : null}
      </section>

      <MemberSummaryTable isCalculatedMonth={isCalculatedMonth} ledger={ledger} members={members} mealStats={memberMealStats} />
      <MealCalendar activeMembers={activeMembers} mealsByDate={mealsByDate} selectedDate={selectedDate} setSelectedDate={setSelectedDate} settings={settings} activeRate={totals.mealRate} />
      <ConfirmModal
        confirmLabel="Close cycle"
        message="This will close the current month and move everyone to the no-active-month state until an admin creates the next month."
        onCancel={() => setConfirmClose(false)}
        onConfirm={closeCycle}
        open={confirmClose}
        title="Close current cycle?"
      />
    </div>
  );
}

function buildMemberMealStats({ members, mealEntries, settings, activeRate }) {
  const stats = members.reduce((acc, person) => {
    acc[person.id] = { meals: 0, mealCost: 0 };
    return acc;
  }, {});

  mealEntries.forEach((entry) => {
    const rate = getMealRateMode(settings) === "calculated" ? activeRate : getMealEntryRate(entry, settings);
    const shares = splitMeal(entry, rate);
    const eaters = entry.eaters || [];
    const portions = entry.portions || {};
    const hasPortions = eaters.some((memberId) => Number(portions[memberId]) > 0);
    const weights = Object.fromEntries(eaters.map((memberId) => [memberId, hasPortions ? Number(portions[memberId]) || 0 : 1]));
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);

    eaters.forEach((memberId) => {
      if (!stats[memberId]) stats[memberId] = { meals: 0, mealCost: 0 };
      const mealCount = totalWeight > 0 ? (Number(entry.boxCount || 0) * weights[memberId]) / totalWeight : 0;
      stats[memberId].meals = taka(stats[memberId].meals + mealCount);
      stats[memberId].mealCost = taka(stats[memberId].mealCost + (shares[memberId] || 0));
    });
  });

  return stats;
}

function groupMealsByDate(mealEntries) {
  return mealEntries.reduce((acc, entry) => {
    acc[entry.date] = [...(acc[entry.date] || []), entry];
    return acc;
  }, {});
}

function Metric({ detail, icon: Icon, label, value }) {
  return (
    <article className="metric">
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function MemberSummaryTable({ isCalculatedMonth, ledger, mealStats, members }) {
  const rows = members.filter((member) => member.active).map((member) => ledger[member.id]).filter(Boolean);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Per-member summary</h2>
        <p>Everyone can see meals, costs, deposits, and current balance.</p>
      </div>
      <div className="table-wrap">
        <table>
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
                <td>{row.name}</td>
                <td>{mealStats[row.memberId]?.meals || 0}</td>
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

function MealCalendar({ activeMembers, activeRate, mealsByDate, selectedDate, setSelectedDate, settings }) {
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
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Meal calendar</h2>
        <p>Click a date to inspect lunch and dinner details.</p>
      </div>
      <div className="calendar-toolbar">
        <input type="month" value={selectedDate.slice(0, 7)} onChange={(event) => setSelectedDate(`${event.target.value}-01`)} />
        <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <strong key={day}>{day}</strong>
        ))}
        {cells.map((cell) =>
          cell.blank ? (
            <span className="calendar-day blank" key={cell.key} />
          ) : (
            <button className={cell.date === selectedDate ? "calendar-day selected" : "calendar-day"} key={cell.date} onClick={() => openDateDetails(cell.date)}>
              <span>{cell.day}</span>
              {cell.entries.length ? <small>{cell.entries.length} meals</small> : null}
            </button>
          ),
        )}
      </div>
      {detailDate ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDetailDate(null)}>
          <div className="modal-card meal-details-modal" role="dialog" aria-modal="true" aria-labelledby="meal-details-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <h2 id="meal-details-title">Meals on {detailDate}</h2>
              <p>{detailEntries.length ? "Approved lunch and dinner split for this date." : "No approved meals were found for this date."}</p>
            </div>
            <div className="daily-details">
              {detailEntries.map((entry) => {
                const rate = getMealRateMode(settings) === "calculated" ? activeRate : getMealEntryRate(entry, settings);
                const shares = splitMeal(entry, rate);
                return (
                  <article className="daily-meal-card" key={entry.id}>
                    <strong>
                      {entry.session} · {entry.boxCount} ordered · {formatTk(rate)} rate
                    </strong>
                    <div>
                      {Object.entries(shares).map(([memberId, amount]) => (
                        <span key={memberId}>
                          {activeMembers.find((person) => person.id === memberId)?.name || memberId}: {formatTk(amount)}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
              {!detailEntries.length ? <p className="empty">No approved meals for this date.</p> : null}
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

function Meals({ activeMembers, currentCycle, dailyMeals, expenses, isAdmin, mealEntries, member, settings, setMessage }) {
  const [date, setDate] = useState(today());
  const [lunchRate, setLunchRate] = useState(settings.mealRate || 70);
  const [lunchOrdered, setLunchOrdered] = useState(0);
  const [lunchPortions, setLunchPortions] = useState({});
  const [lunchSkipped, setLunchSkipped] = useState(false);
  const [dinnerRate, setDinnerRate] = useState(settings.mealRate || 70);
  const [dinnerOrdered, setDinnerOrdered] = useState(0);
  const [dinnerPortions, setDinnerPortions] = useState({});
  const [dinnerSkipped, setDinnerSkipped] = useState(false);
  const [editingRates, setEditingRates] = useState({ lunch: false, dinner: false });
  const [isEditingDay, setIsEditingDay] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [optimisticDailyMeal, setOptimisticDailyMeal] = useState(null);

  const savedDailyMeal = useMemo(() => dailyMeals.find((entry) => entry.date === date), [dailyMeals, date]);
  const existingDailyMeal = savedDailyMeal || (optimisticDailyMeal?.cycleId === currentCycle.id && optimisticDailyMeal?.date === date ? optimisticDailyMeal : null);

  function blankPortions() {
    const initial = {};
    activeMembers.forEach((m) => {
      initial[m.id] = 0;
    });
    return initial;
  }

  function hydratePortions(portions = {}) {
    return { ...blankPortions(), ...portions };
  }

  useEffect(() => {
    const defaultRate = settings.mealRate || 70;

    if (existingDailyMeal) {
      setLunchOrdered(existingDailyMeal.lunch?.boxCount || 0);
      setLunchRate(existingDailyMeal.lunch?.rate || defaultRate);
      setLunchPortions(hydratePortions(existingDailyMeal.lunch?.portions));
      setLunchSkipped(Boolean(existingDailyMeal.lunch?.skipped));
      setDinnerOrdered(existingDailyMeal.dinner?.boxCount || 0);
      setDinnerRate(existingDailyMeal.dinner?.rate || defaultRate);
      setDinnerPortions(hydratePortions(existingDailyMeal.dinner?.portions));
      setDinnerSkipped(Boolean(existingDailyMeal.dinner?.skipped));
    } else {
      setLunchOrdered(0);
      setLunchRate(defaultRate);
      setLunchPortions(blankPortions());
      setLunchSkipped(false);
      setDinnerOrdered(0);
      setDinnerRate(defaultRate);
      setDinnerPortions(blankPortions());
      setDinnerSkipped(false);
    }

    setIsEditingDay(false);
    setEditingRates({ lunch: false, dinner: false });
  }, [activeMembers, existingDailyMeal, settings.mealRate]);

  useEffect(() => {
    if (savedDailyMeal && optimisticDailyMeal?.id === savedDailyMeal.id) {
      setOptimisticDailyMeal(null);
    }
  }, [optimisticDailyMeal, savedDailyMeal]);

  const isCalculated = getMealRateMode(settings) === "calculated";
  const sessionRate = isCalculated ? getCalculatedMealRate({ mealEntries, expenses, settings }) : Number(settings.mealRate || 70);
  const canEditExisting = isAdmin || (existingDailyMeal?.createdBy === member.id && existingDailyMeal?.status === "pending");
  const canEditSheet = !existingDailyMeal || isEditingDay;
  const selectedDayLabel = date === today() ? "today" : "selected date";
  const cycleStartDate = currentCycle?.startDate || "";
  const isDateBeforeCycle = isBeforeDate(date, cycleStartDate);
  const lunchActiveRate = isCalculated ? sessionRate : Number(lunchRate || settings.mealRate || 70);
  const dinnerActiveRate = isCalculated ? sessionRate : Number(dinnerRate || settings.mealRate || 70);
  const lunchPreview = splitMeal({
    boxCount: lunchSkipped ? 0 : Number(lunchOrdered),
    rate: lunchActiveRate,
    eaters: lunchSkipped ? [] : selectedMemberIds(lunchPortions),
    portions: lunchSkipped ? {} : positivePortions(lunchPortions),
  });
  const dinnerPreview = splitMeal({
    boxCount: dinnerSkipped ? 0 : Number(dinnerOrdered),
    rate: dinnerActiveRate,
    eaters: dinnerSkipped ? [] : selectedMemberIds(dinnerPortions),
    portions: dinnerSkipped ? {} : positivePortions(dinnerPortions),
  });
  const lunchTotal = lunchSkipped ? 0 : taka((Number(lunchOrdered) || 0) * lunchActiveRate);
  const dinnerTotal = dinnerSkipped ? 0 : taka((Number(dinnerOrdered) || 0) * dinnerActiveRate);
  const lunchPeople = lunchSkipped ? 0 : selectedMemberIds(lunchPortions).length;
  const dinnerPeople = dinnerSkipped ? 0 : selectedMemberIds(dinnerPortions).length;

  function selectedMemberIds(portions) {
    return Object.entries(portions)
      .filter(([, val]) => Number(val) > 0)
      .map(([id]) => id);
  }

  function positivePortions(portions) {
    return Object.fromEntries(Object.entries(portions).filter(([, val]) => Number(val) > 0).map(([id, val]) => [id, Number(val)]));
  }

  function updatePortion(setter, memberId, value) {
    setter((current) => ({ ...current, [memberId]: Math.max(0, Number(value) || 0) }));
  }

  function adjustPortion(setter, memberId, delta) {
    setter((current) => ({ ...current, [memberId]: Math.max(0, taka((Number(current[memberId]) || 0) + delta)) }));
  }

  function setAllPortions(setter, value) {
    const next = {};
    activeMembers.forEach((person) => {
      next[person.id] = value;
    });
    setter(next);
  }

  function buildSession(boxCount, rate, portions, skipped) {
    if (skipped) {
      return {
        boxCount: 0,
        rate: Number(rate || settings.mealRate || 70),
        eaters: [],
        portions: {},
        skipped: true,
      };
    }

    const eaters = selectedMemberIds(portions);
    return {
      boxCount: Number(boxCount) || 0,
      rate: Number(rate || settings.mealRate || 70),
      eaters,
      portions: positivePortions(portions),
      skipped: false,
    };
  }

  function cancelEditing() {
    if (!existingDailyMeal) {
      setIsEditingDay(false);
      return;
    }

    const defaultRate = settings.mealRate || 70;
    setLunchOrdered(existingDailyMeal.lunch?.boxCount || 0);
    setLunchRate(existingDailyMeal.lunch?.rate || defaultRate);
    setLunchPortions(hydratePortions(existingDailyMeal.lunch?.portions));
    setLunchSkipped(Boolean(existingDailyMeal.lunch?.skipped));
    setDinnerOrdered(existingDailyMeal.dinner?.boxCount || 0);
    setDinnerRate(existingDailyMeal.dinner?.rate || defaultRate);
    setDinnerPortions(hydratePortions(existingDailyMeal.dinner?.portions));
    setDinnerSkipped(Boolean(existingDailyMeal.dinner?.skipped));
    setEditingRates({ lunch: false, dinner: false });
    setIsEditingDay(false);
  }

  async function approveDailyMeal() {
    if (!existingDailyMeal) return;
    await updateRecord("dailyMeals", existingDailyMeal.id, { status: "approved" });
    setMessage(`Daily meal sheet approved for ${date}.`);
  }

  async function submitDailySheet(event) {
    event.preventDefault();

    if (isDateBeforeCycle) {
      return setMessage(`Meal date cannot be before this cycle started on ${cycleStartDate}.`);
    }

    const lunchEaters = lunchSkipped ? [] : Object.entries(lunchPortions).filter(([, val]) => Number(val) > 0);
    const dinnerEaters = dinnerSkipped ? [] : Object.entries(dinnerPortions).filter(([, val]) => Number(val) > 0);

    if (!lunchSkipped && !lunchEaters.length && !dinnerSkipped && !dinnerEaters.length) {
      return setMessage("Add portions for lunch or dinner, or mark the skipped session as No lunch / No dinner.");
    }

    if ((!lunchSkipped && lunchEaters.length && Number(lunchOrdered) <= 0) || (!dinnerSkipped && dinnerEaters.length && Number(dinnerOrdered) <= 0)) {
      return setMessage("Ordered meals must be greater than zero for sessions that are not marked as skipped.");
    }

    const docId = `${currentCycle.id}_${date}`;
    const payload = {
      cycleId: currentCycle.id,
      date,
      rateMode: getMealRateMode(settings),
      lunch: buildSession(lunchOrdered, lunchRate, lunchPortions, lunchSkipped),
      dinner: buildSession(dinnerOrdered, dinnerRate, dinnerPortions, dinnerSkipped),
      status: isAdmin ? "approved" : "pending",
      createdBy: existingDailyMeal?.createdBy || member.id,
      createdByName: existingDailyMeal?.createdByName || member.name,
    };

    if (!existingDailyMeal) payload.createdAt = serverTimestamp();

    try {
      setIsSaving(true);
      await setRecord("dailyMeals", docId, payload);
      setOptimisticDailyMeal({ id: docId, ...payload });
      setIsEditingDay(false);
      setEditingRates({ lunch: false, dinner: false });
      setMessage(
        isAdmin
          ? `Daily meal sheet ${existingDailyMeal ? "updated" : "saved"} for ${date}.`
          : "Daily meal sheet submitted for admin approval."
      );
    } catch (error) {
      console.error("Daily meal save failed", error);
      setMessage(error.code === "permission-denied" ? "Could not save meal. Deploy the latest firestore.rules for dailyMeals, then try again." : error.message);
    } finally {
      setIsSaving(false);
    }
  }

  if (!existingDailyMeal && !isEditingDay) {
    return (
      <section className="panel meal-empty-panel">
        <div className="section-heading">
          <h2>Advanced daily meal sheet</h2>
          <p>Select a date. If no meal has been added, start one blank daily sheet for that date.</p>
        </div>
        <div className="meal-sheet-top compact">
          <label>
            Date
            <input min={cycleStartDate} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {isDateBeforeCycle ? <p className="empty">This date is before the current cycle started on {cycleStartDate}.</p> : null}
        <div className="date-empty-state">
          <Soup size={28} />
          <div>
            <strong>No meal added for {selectedDayLabel}</strong>
            <p>This date has no lunch or dinner sheet yet.</p>
          </div>
          <button className="primary" disabled={isDateBeforeCycle} type="button" onClick={() => setIsEditingDay(true)}>
            <Plus size={18} /> Add {selectedDayLabel}'s meal
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="meals-layout-single">
      <section className="panel">
        <div className="section-heading">
          <div className="meal-heading-row">
            <div>
              <h2>Advanced daily meal sheet</h2>
              <p>
                {existingDailyMeal
                  ? `Showing saved meal for ${date}. ${canEditSheet ? "Update lunch, dinner, and portions." : "Open edit mode before changing anything."}`
                  : "Enter total ordered meals for lunch and dinner, then assign member portions for the split."}
              </p>
            </div>
            {existingDailyMeal ? <span className={existingDailyMeal.status === "approved" ? "status-badge approved" : "status-badge pending"}>{existingDailyMeal.status}</span> : null}
          </div>
        </div>
        <form onSubmit={submitDailySheet} className="form-grid">
          <div className="meal-sheet-top compact">
            <label>
              Date
              <input min={cycleStartDate} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          {isDateBeforeCycle ? <p className="empty">This date is before the current cycle started on {cycleStartDate}.</p> : null}

          <div className="meal-day-summary">
            <article>
              <span>Lunch</span>
              <strong>{formatTk(lunchTotal)}</strong>
              <small>{lunchSkipped ? "No lunch" : `${lunchOrdered || 0} ordered · ${lunchPeople} members`}</small>
            </article>
            <article>
              <span>Dinner</span>
              <strong>{formatTk(dinnerTotal)}</strong>
              <small>{dinnerSkipped ? "No dinner" : `${dinnerOrdered || 0} ordered · ${dinnerPeople} members`}</small>
            </article>
            <article>
              <span>Day total</span>
              <strong>{formatTk(lunchTotal + dinnerTotal)}</strong>
              <small>{taka((lunchSkipped ? 0 : Number(lunchOrdered || 0)) + (dinnerSkipped ? 0 : Number(dinnerOrdered || 0)))} ordered meals</small>
            </article>
          </div>

          <div className="meal-session-grid">
            <MealSessionEditor
              activeMembers={activeMembers}
              defaultRate={settings.mealRate || 70}
              disabled={!canEditSheet}
              editingRate={editingRates.lunch}
              label="Lunch"
              ordered={lunchOrdered}
              portions={lunchPortions}
              preview={lunchPreview}
              rate={isCalculated ? sessionRate : lunchRate}
              skipped={lunchSkipped}
              setOrdered={setLunchOrdered}
              setPortions={setLunchPortions}
              setRate={setLunchRate}
              setEditingRate={(value) => setEditingRates((current) => ({ ...current, lunch: value }))}
              setSkipped={setLunchSkipped}
              updatePortion={updatePortion}
              adjustPortion={adjustPortion}
              setAllPortions={setAllPortions}
            />
            <MealSessionEditor
              activeMembers={activeMembers}
              defaultRate={settings.mealRate || 70}
              disabled={!canEditSheet}
              editingRate={editingRates.dinner}
              label="Dinner"
              ordered={dinnerOrdered}
              portions={dinnerPortions}
              preview={dinnerPreview}
              rate={isCalculated ? sessionRate : dinnerRate}
              skipped={dinnerSkipped}
              setOrdered={setDinnerOrdered}
              setPortions={setDinnerPortions}
              setRate={setDinnerRate}
              setEditingRate={(value) => setEditingRates((current) => ({ ...current, dinner: value }))}
              setSkipped={setDinnerSkipped}
              updatePortion={updatePortion}
              adjustPortion={adjustPortion}
              setAllPortions={setAllPortions}
            />
          </div>

          <div className="form-actions">
            {isAdmin && existingDailyMeal?.status === "pending" && !canEditSheet ? (
              <button className="primary" type="button" onClick={approveDailyMeal}>
                <Check size={18} /> Approve selected date
              </button>
            ) : null}
            {existingDailyMeal && !canEditSheet && canEditExisting ? (
              <button className="secondary" type="button" onClick={() => setIsEditingDay(true)}>
                <Pencil size={18} /> Edit selected date
              </button>
            ) : null}
            {canEditSheet ? (
              <>
                {existingDailyMeal ? <button className="secondary" type="button" onClick={cancelEditing}>Cancel</button> : null}
                <button className="primary" disabled={isSaving || isDateBeforeCycle} type="submit">
                  <Check size={18} /> {isSaving ? "Saving..." : existingDailyMeal ? "Update selected date" : "Save selected date"}
                </button>
              </>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

function MealSessionEditor({
  activeMembers,
  adjustPortion,
  defaultRate,
  disabled = false,
  editingRate,
  label,
  ordered,
  portions,
  preview,
  rate,
  setAllPortions,
  setEditingRate,
  setOrdered,
  setPortions,
  setRate,
  setSkipped,
  skipped,
  updatePortion,
}) {
  const controlsDisabled = disabled || skipped;
  const totalPortions = skipped ? 0 : taka(Object.values(portions).reduce((sum, value) => sum + Number(value || 0), 0));
  const estimatedTotal = skipped ? 0 : taka((Number(ordered) || 0) * (Number(rate) || 0));
  const activeCount = skipped ? 0 : Object.values(portions).filter((value) => Number(value) > 0).length;

  return (
    <section className={disabled ? "meal-session-box readonly" : skipped ? "meal-session-box skipped" : "meal-session-box"}>
      <div className="meal-session-header">
        <div>
          <h3>{label}</h3>
          <span>{skipped ? `No ${label.toLowerCase()} selected` : `${formatTk(estimatedTotal)} total · ${activeCount} members eating`}</span>
        </div>
        <label className="checkbox-line session-skip-toggle">
          <input disabled={disabled} checked={skipped} type="checkbox" onChange={(event) => setSkipped(event.target.checked)} />
          No {label.toLowerCase()}
        </label>
        <div className="session-controls">
          <label>
            Ordered meals
            <input disabled={controlsDisabled} min="0" step="0.5" type="number" value={ordered} onChange={(event) => setOrdered(event.target.value)} />
          </label>
          <label>
            Rate
            <div className={editingRate ? "rate-inline-editor editing" : "rate-inline-editor"}>
              {editingRate ? (
                <input
                  autoFocus
                  min="1"
                  type="number"
                  disabled={controlsDisabled}
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setEditingRate(false);
                    }
                  }}
                />
              ) : (
                <span>{formatTk(rate)}</span>
              )}
              {editingRate ? (
                <button
                  disabled={controlsDisabled}
                  type="button"
                  title="Confirm rate"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingRate(false);
                  }}
                >
                  <Check size={13} />
                </button>
              ) : (
                <button disabled={controlsDisabled} type="button" title="Edit rate" onClick={() => setEditingRate(true)}>
                  <Pencil size={13} />
                </button>
              )}
              <button
                disabled={controlsDisabled}
                type="button"
                title="Reset rate"
                onClick={() => {
                  setRate(defaultRate || 70);
                  setEditingRate(false);
                }}
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </label>
        </div>
        <div className="meal-quick-actions">
          <button disabled={controlsDisabled} type="button" onClick={() => setAllPortions(setPortions, 1)}>All 1</button>
          <button disabled={controlsDisabled} type="button" onClick={() => setAllPortions(setPortions, 0.5)}>All 0.5</button>
          <button disabled={controlsDisabled} type="button" onClick={() => setAllPortions(setPortions, 0)}>Clear</button>
        </div>
      </div>

      <div className="meal-member-list">
        {activeMembers.map((person) => (
          <div className="meal-member-row" key={person.id}>
            <span>{person.name}</span>
            <div className="portion-controls">
              <button disabled={controlsDisabled} type="button" onClick={() => adjustPortion(setPortions, person.id, -0.5)}>-</button>
              <input
                disabled={controlsDisabled}
                min="0"
                step="0.25"
                type="number"
                value={portions[person.id] ?? 0}
                onChange={(event) => updatePortion(setPortions, person.id, event.target.value)}
              />
              <button disabled={controlsDisabled} type="button" onClick={() => adjustPortion(setPortions, person.id, 0.5)}>+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="meal-session-summary">
        <span>{totalPortions} member portions</span>
        {Object.entries(preview).map(([memberId, amount]) => (
          <span key={memberId}>
            {activeMembers.find((item) => item.id === memberId)?.name || memberId}: {formatTk(amount)}
          </span>
        ))}
      </div>
    </section>
  );
}

function Expenses({ currentCycle, expenses, isAdmin, member, setMessage }) {
  const [form, setForm] = useState(emptyExpense);
  const visibleExpenses = isAdmin ? expenses : expenses.filter((expense) => expense.createdBy === member.id || expense.status === "approved");

  async function submitExpense(event) {
    event.preventDefault();
    if (Number(form.amount) <= 0) return setMessage("Add expense amount.");
    await addRecord("expenses", {
      cycleId: currentCycle.id,
      date: form.date,
      title: form.title,
      category: form.category,
      amount: Number(form.amount),
      payerId: "mess_cash",
      splitMethod: "mess_fund",
      participants: [],
      customShares: {},
      status: isAdmin ? "approved" : "pending",
      createdBy: member.id,
      createdByName: member.name,
    });
    setForm({ ...emptyExpense, date: form.date });
    setMessage(isAdmin ? "Expense added." : "Expense submitted for admin approval.");
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-heading">
          <h2>Add mess fund expense</h2>
          <p>All expenses here are paid from the shared mess fund.</p>
        </div>
        <form className="form-grid" onSubmit={submitExpense}>
          <label>
            Date
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </label>
          <label>
            Title
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            Category
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              <option value="bazaar">Bazaar</option>
              <option value="utility">Utility</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Amount
            <input min="1" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </label>
          <div className="fund-note">
            Paid by Mess Cash Fund
          </div>
          <button className="primary" type="submit">
            <Plus size={18} /> Save expense
          </button>
        </form>
      </section>
      <section className="stack">
        <EntryList entries={visibleExpenses} isAdmin={isAdmin} members={[]} type="expenses" />
      </section>
    </div>
  );
}

function EntryList({ entries, isAdmin, members, type }) {
  const title = type === "mealEntries" ? "Meal entries" : "Expense entries";
  const pendingEntries = entries.filter((entry) => entry.status === "pending");
  const approvedEntries = entries.filter((entry) => entry.status !== "pending");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  async function approve(entry) {
    await updateRecord(type, entry.id, { status: "approved" });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await deleteRecord(type, deleteTarget.id);
    setDeleteTarget(null);
  }

  function renderEntry(entry) {
    const isMeal = type === "mealEntries";
    if (isMeal) {
      const eaterNames = entry.eaters?.map((id) => members.find((member) => member.id === id)?.name || id) || [];
      const portions = entry.portions || {};
      return (
        <article className={entry.status === "pending" ? "meal-entry-card pending" : "meal-entry-card"} key={entry.id}>
          <div className="meal-entry-main">
            <div className="meal-entry-session">
              <span>{entry.session}</span>
              <strong>{entry.boxCount} ordered</strong>
            </div>
            <div className="meal-entry-info">
              <div className="meal-entry-meta">
                <strong>{entry.date}</strong>
                <span>{formatTk(entry.rate)} per meal · {entry.status} · by {entry.createdByName || "admin"}</span>
              </div>
              <div className="meal-entry-eaters">
                {eaterNames.map((name, index) => {
                  const memberId = entry.eaters[index];
                  const portion = portions[memberId];
                  return (
                    <span key={memberId}>
                      {name}{portion ? ` · ${portion}` : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          {isAdmin ? (
            <div className="row-actions meal-entry-actions">
              <button className="icon-button" title="Edit" onClick={() => setEditTarget(entry)}>
                <Pencil size={17} />
              </button>
              {entry.status === "pending" ? (
                <button className="approve-text-button" title="Approve" onClick={() => approve(entry)}>
                  <Check size={16} /> Approve
                </button>
              ) : null}
              <button className="icon-button danger-icon" title="Delete" onClick={() => setDeleteTarget(entry)}>
                <Trash2 size={17} />
              </button>
            </div>
          ) : null}
        </article>
      );
    }

    return (
      <article className={entry.status === "pending" ? "entry-row pending" : "entry-row"} key={entry.id}>
        <div>
          <strong>{`${entry.title} · ${formatTk(entry.amount)}`}</strong>
          <span>
            {entry.date} · {entry.status} · by {entry.createdByName || "admin"}
          </span>
          <small>
            Paid by Mess Cash Fund
          </small>
        </div>
        {isAdmin ? (
          <div className="row-actions">
            <button className="icon-button" title="Edit" onClick={() => setEditTarget(entry)}>
              <Pencil size={17} />
            </button>
            {entry.status === "pending" ? (
              <button className="approve-text-button" title="Approve" onClick={() => approve(entry)}>
                <Check size={16} /> Approve
              </button>
            ) : null}
            <button className="icon-button danger-icon" title="Delete" onClick={() => setDeleteTarget(entry)}>
              <Trash2 size={17} />
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{title}</h2>
        <p>
          {isAdmin
            ? pendingEntries.length
              ? `${pendingEntries.length} pending entr${pendingEntries.length === 1 ? "y" : "ies"} need approval.`
              : "No pending approvals right now."
            : "Your pending submissions appear here until an admin approves them."}
        </p>
      </div>
      <div className="entry-list">
        {pendingEntries.length ? <div className="entry-group-label">Pending approval</div> : null}
        {pendingEntries.map(renderEntry)}
        {pendingEntries.length && approvedEntries.length ? <div className="entry-group-label">Approved / recorded</div> : null}
        {approvedEntries.map(renderEntry)}
        {!entries.length ? <p className="empty">No entries yet.</p> : null}
      </div>
      <EntryEditModal
        entry={editTarget}
        members={members}
        onCancel={() => setEditTarget(null)}
        onSave={async (payload) => {
          await updateRecord(type, editTarget.id, payload);
          setEditTarget(null);
        }}
        type={type}
      />
      <ConfirmModal
        confirmLabel="Delete"
        message="This action cannot be undone."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        open={Boolean(deleteTarget)}
        title={`Delete ${type === "mealEntries" ? "meal entry" : "expense"}?`}
      />
    </section>
  );
}

function EntryEditModal({ entry, members, onCancel, onSave, type }) {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!entry) {
      setDraft(null);
      return;
    }
    setDraft({
      ...entry,
      portions: { ...(entry.portions || {}) },
    });
  }, [entry]);

  if (!entry || !draft) return null;

  const isMeal = type === "mealEntries";

  function updatePortion(memberId, value) {
    setDraft((current) => ({ ...current, portions: { ...current.portions, [memberId]: Math.max(0, Number(value) || 0) } }));
  }

  function save(event) {
    event.preventDefault();
    if (isMeal) {
      const portions = Object.fromEntries(Object.entries(draft.portions || {}).filter(([, value]) => Number(value) > 0).map(([id, value]) => [id, Number(value)]));
      onSave({
        date: draft.date,
        session: draft.session,
        boxCount: Number(draft.boxCount) || 0,
        rate: Number(draft.rate) || 0,
        eaters: Object.keys(portions),
        portions,
      });
      return;
    }
    onSave({
      date: draft.date,
      title: draft.title,
      category: draft.category,
      amount: Number(draft.amount) || 0,
      payerId: "mess_cash",
      splitMethod: "mess_fund",
      participants: [],
      customShares: {},
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card edit-modal" onSubmit={save}>
        <div className="modal-heading">
          <h2>{isMeal ? "Edit meal entry" : "Edit mess fund expense"}</h2>
          <p>Update the date and details for this record.</p>
        </div>
        <div className="form-grid">
          <label>
            Date
            <input type="date" value={draft.date || ""} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
          </label>
          {isMeal ? (
            <>
              <label>
                Session
                <select value={draft.session || "lunch"} onChange={(event) => setDraft({ ...draft, session: event.target.value })}>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                </select>
              </label>
              <label>
                Ordered meals
                <input min="0" step="0.5" type="number" value={draft.boxCount || 0} onChange={(event) => setDraft({ ...draft, boxCount: event.target.value })} />
              </label>
              <label>
                Rate
                <input min="1" type="number" value={draft.rate || 0} onChange={(event) => setDraft({ ...draft, rate: event.target.value })} />
              </label>
              <div className="edit-portions">
                {members.map((person) => (
                  <label key={person.id}>
                    {person.name}
                    <input min="0" step="0.25" type="number" value={draft.portions?.[person.id] || 0} onChange={(event) => updatePortion(person.id, event.target.value)} />
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <label>
                Title
                <input value={draft.title || ""} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label>
                Category
                <select value={draft.category || "bazaar"} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                  <option value="bazaar">Bazaar</option>
                  <option value="utility">Utility</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Amount
                <input min="1" type="number" value={draft.amount || ""} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
              </label>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit">Save changes</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmModal({ confirmLabel = "Confirm", message, onCancel, onConfirm, open, title }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-heading">
          <h2 id="confirm-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="danger" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Deposits({ activeMembers, currentCycle, deposits, isAdmin, member, setMessage }) {
  const [form, setForm] = useState({ date: today(), memberId: member.id, amount: "", note: "Advance deposit" });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const visibleDeposits = isAdmin ? deposits : deposits.filter((deposit) => deposit.memberId === member.id || deposit.status === "approved");

  async function submitDeposit(event) {
    event.preventDefault();
    if (!form.memberId || Number(form.amount) <= 0) return setMessage("Select member and add a deposit amount.");
    await addRecord("deposits", {
      cycleId: currentCycle.id,
      date: form.date,
      memberId: form.memberId,
      amount: Number(form.amount),
      note: form.note,
      status: isAdmin ? "approved" : "pending",
      createdBy: member.id,
      createdByName: member.name,
    });
    setForm({ ...form, amount: "", note: "Advance deposit" });
    setMessage(isAdmin ? "Deposit added." : "Deposit submitted for admin approval.");
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-heading">
          <h2>Add deposit or advance</h2>
          <p>Track money members hand in to the mess cash fund.</p>
        </div>
        <form className="form-grid" onSubmit={submitDeposit}>
          <label>
            Date
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </label>
          <label>
            Member
            <select value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}>
              {activeMembers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input min="1" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </label>
          <label>
            Note
            <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </label>
          <button className="primary" type="submit">
            <Plus size={18} /> Save deposit
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Deposit entries</h2>
          <p>Pending member entries wait for admin approval.</p>
        </div>
        <div className="entry-list">
          {visibleDeposits.map((deposit) => (
            <article className="entry-row" key={deposit.id}>
              <div>
                <strong>{formatTk(deposit.amount)}</strong>
                <span>
                  {deposit.date} · {deposit.status} · {activeMembers.find((person) => person.id === deposit.memberId)?.name || deposit.memberId}
                </span>
                <small>{deposit.note || "Deposit"}</small>
              </div>
              {isAdmin ? (
                <div className="row-actions">
                  {deposit.status === "pending" ? (
                    <button className="icon-button approve" title="Approve" onClick={() => updateRecord("deposits", deposit.id, { status: "approved" })}>
                      <Check size={17} />
                    </button>
                  ) : null}
                  <button className="icon-button danger-icon" title="Delete" onClick={() => setDeleteTarget(deposit)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {!visibleDeposits.length ? <p className="empty">No deposits yet.</p> : null}
        </div>
      </section>
      <ConfirmModal
        confirmLabel="Delete"
        message="This deposit entry will be permanently removed."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          await deleteRecord("deposits", deleteTarget.id);
          setDeleteTarget(null);
        }}
        open={Boolean(deleteTarget)}
        title="Delete deposit?"
      />
    </div>
  );
}

function Members({ members, setMessage }) {
  const [form, setForm] = useState({ name: "", email: "", role: "member" });

  async function submitMember(event) {
    event.preventDefault();
    if (!form.name || !form.email) return setMessage("Member name and Gmail are required.");
    const email = form.email.toLowerCase();
    await setDoc(doc(db, "members", email), {
      name: form.name,
      email,
      role: form.role,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setForm({ name: "", email: "", role: "member" });
    setMessage("Member added.");
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-heading">
          <h2>Add member</h2>
          <p>Only active listed Gmail accounts can access the app.</p>
        </div>
        <form className="form-grid" onSubmit={submitMember}>
          <label>
            Name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Gmail
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="primary" type="submit">
            <Plus size={18} /> Add member
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Household members</h2>
          <p>Manage role and access status.</p>
        </div>
        <div className="entry-list">
          {members.map((person) => (
            <article className="entry-row" key={person.id}>
              <div>
                <MemberNameEditor person={person} setMessage={setMessage} />
                <span>{person.email}</span>
                <small>
                  {person.role} · {person.active ? "active" : "inactive"}
                </small>
              </div>
              <div className="row-actions wide">
                <select value={person.role} onChange={(event) => updateRecord("members", person.id, { role: event.target.value })}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="secondary" onClick={() => updateRecord("members", person.id, { active: !person.active })}>
                  {person.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function MemberNameEditor({ person, setMessage }) {
  const [name, setName] = useState(person.name || "");

  useEffect(() => {
    setName(person.name || "");
  }, [person.name]);

  async function saveName() {
    const nextName = name.trim();
    if (!nextName || nextName === person.name) return;
    await updateRecord("members", person.id, { name: nextName });
    setMessage("Member name updated.");
  }

  return (
    <input
      className="inline-name-input"
      value={name}
      onBlur={saveName}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function History({ cycles }) {
  const closed = cycles.filter((cycle) => cycle.status === "closed");
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Closed cycles</h2>
        <p>Each closed cycle keeps a balance snapshot.</p>
      </div>
      <div className="history-grid">
        {closed.map((cycle) => (
          <article className="history-item" key={cycle.id}>
            <strong>
              {cycle.startDate} to {cycle.endDate}
            </strong>
            <span>Meals {formatTk(cycle.snapshot?.totals?.meals || 0)}</span>
            <span>Expenses {formatTk(cycle.snapshot?.totals?.expenses || 0)}</span>
            <div className="mini-ledger">
              {Object.values(cycle.snapshot?.ledger || {}).map((row) => (
                <small key={row.memberId}>
                  {row.name}: {formatTk(row.balance)}
                </small>
              ))}
            </div>
          </article>
        ))}
        {!closed.length ? <p className="empty">No closed cycles yet.</p> : null}
      </div>
    </section>
  );
}
