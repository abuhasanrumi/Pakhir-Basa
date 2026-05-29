import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import {
  Banknote,
  CalendarCheck,
  Check,
  CircleDollarSign,
  LogOut,
  Menu,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Shield,
  Soup,
  Trash2,
  Users,
  Wallet,
  X,
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
  const [selectedHistoryCycleId, setSelectedHistoryCycleId] = useState("");
  const [activeView, setActiveView] = useState("dashboard");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!message) return undefined;
    const timeoutId = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

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
          setSelectedHistoryCycleId("");
          setMobileSidebarOpen(false);
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
  const householdActiveMembers = members.filter((item) => item.active);
  const cycleMemberIds = currentCycle?.memberIds || [];
  const activeMembers = householdActiveMembers.filter((item) => cycleMemberIds.includes(item.id));
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
        members={members}
        cycles={cycles}
        selectedHistoryCycleId={selectedHistoryCycleId}
        setCurrentCycle={setCurrentCycle}
        setMobileSidebarOpen={setMobileSidebarOpen}
        setSelectedHistoryCycleId={setSelectedHistoryCycleId}
        setMessage={setMessage}
        sidebarOpen={mobileSidebarOpen}
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
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={mobileSidebarOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileSidebarOpen}
        onClick={() => setMobileSidebarOpen((current) => !current)}
      >
        {mobileSidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      {mobileSidebarOpen ? <div className="sidebar-backdrop" role="presentation" onClick={() => setMobileSidebarOpen(false)} /> : null}
      <aside className={mobileSidebarOpen ? "sidebar sidebar--open" : "sidebar"}>
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
              <button
                className={activeView === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                onClick={() => {
                  setActiveView(item.id);
                  setMobileSidebarOpen(false);
                }}
              >
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
          <div className="topbar-brand">
            <div className="topbar-logo">PB</div>
            <div>
              <strong>Pakhir Basa</strong>
              <span>Meal & Mess Tracker</span>
            </div>
          </div>
          <div className="topbar-page-title">
            <p>{currentCycle?.name || "Current Cycle"}</p>
            <h1>{navigation.find((item) => item.id === activeView)?.label || "Dashboard"}</h1>
          </div>
          {/* <div className="top-actions">
            <span className="status-pill">
              {getMealRateMode(settings) === "calculated" ? "Calculated month: " : "Static month: "}
              {formatTk(totals.mealRate)}
            </span>
          </div> */}
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
            setSelectedHistoryCycleId={setSelectedHistoryCycleId}
            setMobileSidebarOpen={setMobileSidebarOpen}
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
        {activeView === "members" && isAdmin ? <Members currentCycle={currentCycle} cycleMembers={activeMembers} member={member} members={members} setCurrentCycle={setCurrentCycle} setMessage={setMessage} /> : null}
        {activeView === "history" ? <History cycles={cycles} selectedCycleId={selectedHistoryCycleId} onSelectCycle={setSelectedHistoryCycleId} /> : null}
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

function LoginScreen() {
  return (
    <div className="login-screen">
      <section className="login-hero">
        <div>
          <p>Meal tracking workspace</p>
          <h1>Pakhir Basa Meal Tracker</h1>
          <span>Track meals, costs, deposits, and cycle history in one place.</span>
        </div>
      </section>
      <section className="login-panel">
        <Soup size={36} />
        <h2>Sign in to continue</h2>
        <p>Use your Google account to open your meal tracker and continue where you left off.</p>
        <button className="primary" onClick={signInWithGoogle}>
          Continue with Google
        </button>
      </section>
    </div>
  );
}

function Shell({ message }) {
  return (
    <div className="center-screen setup">
      <div className="loading-card">
        <div className="loading-brand">
          <div className="loading-brand__mark">PB</div>
          <div>
            <strong>Pakhir Basa</strong>
            <span>Meal & Mess Tracker</span>
          </div>
        </div>
        <div className="loading-orbit" aria-hidden="true">
          <Soup size={30} />
        </div>
        <div className="loading-copy">
          <span className="eyebrow">Preparing workspace</span>
          <h1>Loading household data</h1>
          <p>{message || "Checking your account, members, and current month."}</p>
        </div>
        <div className="loading-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}

function NoCycleScreen({ cycles, isAdmin, member, members, selectedHistoryCycleId, setCurrentCycle, setMessage, setMobileSidebarOpen, setSelectedHistoryCycleId, sidebarOpen, user }) {
  const selectableMembers = members
    .filter((item) => item.active)
    .sort((left, right) => {
      if (left.id === member.id) return -1;
      if (right.id === member.id) return 1;
      return String(left.name || left.email).localeCompare(String(right.name || right.email));
    });
  const [sidebarView, setSidebarView] = useState(selectedHistoryCycleId ? "history" : "create");
  const [form, setForm] = useState({
    name: new Date().toLocaleString("en", { month: "long", year: "numeric" }),
    startDate: today(),
    rateMode: "static",
    mealRate: 70,
    memberIds: [],
  });

  useEffect(() => {
    setForm((current) => {
      if (current.memberIds.length || !selectableMembers.length) return current;
      return { ...current, memberIds: selectableMembers.some((person) => person.id === member.id) ? [member.id] : [selectableMembers[0].id] };
    });
  }, [member.id, selectableMembers]);

  function toggleCycleMember(memberId) {
    if (memberId === member.id) return;
    setForm((current) => {
      const hasMember = current.memberIds.includes(memberId);
      return {
        ...current,
        memberIds: hasMember ? current.memberIds.filter((id) => id !== memberId) : [...current.memberIds, memberId],
      };
    });
  }

  async function startCycle(event) {
    event.preventDefault();
    if (!form.memberIds.length) return setMessage("Select at least one member for this month.");
    const cycle = {
      name: form.name || "Current Month",
      status: "open",
      startDate: form.startDate,
      mealRateMode: form.rateMode,
      mealRate: Number(form.mealRate) || 70,
      memberIds: form.memberIds,
      createdBy: member.id,
    };
    const ref = await addRecord("cycles", cycle);
    const createdCycle = { id: ref.id, ...cycle };
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
    setCurrentCycle(createdCycle);
    setSelectedHistoryCycleId(createdCycle.id);
    setMobileSidebarOpen(false);
    setMessage("New month started.");
  }

  return (
    <div className="app">
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        aria-expanded={sidebarOpen}
        onClick={() => setMobileSidebarOpen((current) => !current)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      {sidebarOpen ? <div className="sidebar-backdrop" role="presentation" onClick={() => setMobileSidebarOpen(false)} /> : null}
      <aside className={sidebarOpen ? "sidebar sidebar--open" : "sidebar"}>
        <div className="brand">
          <div className="brand-mark">PB</div>
          <div>
            <strong>Pakhir Basar</strong>
            <span>Meal & Mess Tracker</span>
          </div>
        </div>
        {isAdmin ? (
          <nav className="nav no-cycle-nav">
            <button className={sidebarView === "create" ? "nav-item active" : "nav-item"} onClick={() => { setSidebarView("create"); setMobileSidebarOpen(false); }}>
              <Plus size={18} />
              <span>Create month</span>
            </button>
            <button className={sidebarView === "history" ? "nav-item active" : "nav-item"} onClick={() => { setSidebarView("history"); setMobileSidebarOpen(false); }}>
              <Banknote size={18} />
              <span>Cycle history</span>
              {cycles.filter((cycle) => cycle.status === "closed").length ? <b>{cycles.filter((cycle) => cycle.status === "closed").length}</b> : null}
            </button>
          </nav>
        ) : null}
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
        {isAdmin && sidebarView === "history" ? (
          <History cycles={cycles} selectedCycleId={selectedHistoryCycleId} onSelectCycle={setSelectedHistoryCycleId} />
        ) : (
          <section className="panel no-cycle-panel">
            <div className="no-cycle-hero">
              <div className="no-cycle-hero__copy">
                <span className="eyebrow">Month setup</span>
                <h2>No active month</h2>
                <p>{isAdmin ? "Create a new month to start tracking meals, deposits, and expenses." : "A new month will appear here once it is created."}</p>
              </div>
              <div className="no-cycle-hero__badge">
                <CalendarCheck size={18} />
                <span>Ready when you are</span>
              </div>
            </div>

            <div className="no-cycle-overview">
              <article>
                <Soup size={18} />
                <strong>Meals</strong>
                <span>Track lunch and dinner entries in one place.</span>
              </article>
              <article>
                <Wallet size={18} />
                <strong>Deposits</strong>
                <span>Keep advances and shared cash visible.</span>
              </article>
              <article>
                <Banknote size={18} />
                <strong>History</strong>
                <span>Review closed cycles when the month ends.</span>
              </article>
            </div>

            {isAdmin ? (
              <form className="form-grid no-cycle-form" onSubmit={startCycle}>
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
                <div className="cycle-member-picker">
                  <div>
                    <strong>Members for this month</strong>
                    <span>Only selected members will be counted in meals, deposits, and balances.</span>
                  </div>
                  <div className="member-picker">
                    {selectableMembers.map((person) => (
                      <button
                        className={form.memberIds.includes(person.id) ? "chip selected" : "chip"}
                        key={person.id}
                        disabled={person.id === member.id}
                        type="button"
                        onClick={() => toggleCycleMember(person.id)}
                      >
                        {form.memberIds.includes(person.id) ? <Check size={15} /> : null}
                        <span>{person.name}</span>
                        {person.id === member.id ? <small>Admin</small> : null}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="primary no-cycle-form__submit" type="submit">
                  <Plus size={18} /> Create month
                </button>
              </form>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}

function Dashboard({ activeMembers, currentCycle, expenses, isAdmin, isCalculatedMonth, ledger, mealEntries, members, pendingCount, setActiveView, setCurrentCycle, setMobileSidebarOpen, setSelectedHistoryCycleId, setMessage, totals, deposits, messCash, settings }) {
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

    setActiveView("history");
    setSelectedHistoryCycleId(currentCycle.id);
    setMobileSidebarOpen(false);
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
      </section>

      <MemberSummaryTable isCalculatedMonth={isCalculatedMonth} ledger={ledger} members={members} mealStats={memberMealStats} />
      <MealCalendar activeMembers={activeMembers} mealsByDate={mealsByDate} selectedDate={selectedDate} setSelectedDate={setSelectedDate} settings={settings} activeRate={totals.mealRate} />
      {isAdmin ? (
        <section className="admin-danger-zone">
          <div>
            <span className="eyebrow">Admin controls</span>
            <h2>Close current cycle</h2>
            <p>Finalize this month, save the closing snapshot, and move the household to cycle history.</p>
          </div>
          <button className="danger close-cycle-button" onClick={() => setConfirmClose(true)}>
            Close cycle
          </button>
        </section>
      ) : null}
      <ConfirmModal
        confirmLabel="Close cycle"
        message="This will close the current month, save a read-only snapshot, and move everyone to the no-active-month state until an admin creates the next month."
        onCancel={() => setConfirmClose(false)}
        onConfirm={closeCycle}
        open={confirmClose}
        requiredPhrase="close cycle"
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
          <span className="eyebrow">Household ledger</span>
          <h2>Per-member summary</h2>
          <p>Everyone can see meals, costs, deposits, and current balance.</p>
        </div>
        <div className="summary-note">
          <span>{rows.length} active members</span>
          <span>{totalMeals.toFixed(1)} total meals</span>
        </div>
      </div>

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
                    <span>{row.balance >= 0 ? "In credit" : "Needs settlement"}</span>
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
            <div className="modal-heading meal-details-modal__heading">
              <span className="eyebrow">Daily meal split</span>
              <h2 id="meal-details-title">Meals on {detailDate}</h2>
              <p>{detailEntries.length ? "Approved lunch and dinner split for this date." : "No approved meals were found for this date."}</p>
            </div>
            <div className="meal-details-summary">
              <article className="meal-details-summary__item">
                <span>Total boxes ordered</span>
                <strong>{detailEntries.reduce((sum, entry) => sum + Number(entry.boxCount || 0), 0)}</strong>
              </article>
              <article className="meal-details-summary__item">
                <span>Active rate</span>
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
                      <small>{Object.keys(shares).length} member{Object.keys(shares).length === 1 ? "" : "s"} split this meal</small>
                      <strong>{formatTk(totalShare)}</strong>
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
  const [mealFormError, setMealFormError] = useState("");
  const editableMembers = isAdmin ? activeMembers : activeMembers.filter((person) => person.id === member.id);
  const editableMemberIds = new Set(editableMembers.map((person) => person.id));

  const savedDailyMeal = useMemo(() => dailyMeals.find((entry) => entry.date === date), [dailyMeals, date]);
  const existingDailyMeal = savedDailyMeal || (optimisticDailyMeal?.cycleId === currentCycle.id && optimisticDailyMeal?.date === date ? optimisticDailyMeal : null);

  function sumPortions(portions = {}) {
    return Object.values(portions).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  function getSessionBoxCount(session = {}) {
    const savedCount = Number(session.boxCount || 0);
    return isAdmin && savedCount <= 0 ? sumPortions(session.portions) : savedCount;
  }

  function blankPortions() {
    const initial = {};
    editableMembers.forEach((m) => {
      initial[m.id] = 0;
    });
    return initial;
  }

  function hydratePortions(portions = {}) {
    const next = blankPortions();
    Object.entries(portions).forEach(([memberId, value]) => {
      if (editableMemberIds.has(memberId)) {
        next[memberId] = value;
      }
    });
    return next;
  }

  useEffect(() => {
    const defaultRate = settings.mealRate || 70;

    if (existingDailyMeal) {
      setLunchOrdered(getSessionBoxCount(existingDailyMeal.lunch));
      setLunchRate(existingDailyMeal.lunch?.rate || defaultRate);
      setLunchPortions(hydratePortions(existingDailyMeal.lunch?.portions));
      setLunchSkipped(Boolean(existingDailyMeal.lunch?.skipped));
      setDinnerOrdered(getSessionBoxCount(existingDailyMeal.dinner));
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

  useEffect(() => {
    if (!mealFormError) return undefined;
    const timeoutId = window.setTimeout(() => setMealFormError(""), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [mealFormError]);

  const isCalculated = getMealRateMode(settings) === "calculated";
  const sessionRate = isCalculated ? getCalculatedMealRate({ mealEntries, expenses, settings }) : Number(settings.mealRate || 70);
  const canEditExisting = isAdmin || (existingDailyMeal?.createdBy === member.id && existingDailyMeal?.status === "pending");
  const canEditSheet = !existingDailyMeal || isEditingDay;
  const selectedDayLabel = date === today() ? "today" : "selected date";
  const cycleStartDate = currentCycle?.startDate || "";
  const isDateBeforeCycle = isBeforeDate(date, cycleStartDate);
  const lunchActiveRate = isCalculated ? sessionRate : Number(lunchRate || settings.mealRate || 70);
  const dinnerActiveRate = isCalculated ? sessionRate : Number(dinnerRate || settings.mealRate || 70);
  const lunchDemandTotal = sumPortions(lunchPortions);
  const dinnerDemandTotal = sumPortions(dinnerPortions);
  const lunchPreview = splitMeal({
    boxCount: lunchSkipped ? 0 : lunchDemandTotal,
    rate: lunchActiveRate,
    eaters: lunchSkipped ? [] : selectedMemberIds(lunchPortions),
    portions: lunchSkipped ? {} : positivePortions(lunchPortions),
  });
  const dinnerPreview = splitMeal({
    boxCount: dinnerSkipped ? 0 : dinnerDemandTotal,
    rate: dinnerActiveRate,
    eaters: dinnerSkipped ? [] : selectedMemberIds(dinnerPortions),
    portions: dinnerSkipped ? {} : positivePortions(dinnerPortions),
  });
  const lunchTotal = lunchSkipped ? 0 : taka(lunchDemandTotal * lunchActiveRate);
  const dinnerTotal = dinnerSkipped ? 0 : taka(dinnerDemandTotal * dinnerActiveRate);
  const lunchPeople = lunchSkipped ? 0 : selectedMemberIds(lunchPortions).length;
  const dinnerPeople = dinnerSkipped ? 0 : selectedMemberIds(dinnerPortions).length;

  function selectedMemberIds(portions) {
    return Object.entries(portions)
      .filter(([memberId, val]) => editableMemberIds.has(memberId) && Number(val) > 0)
      .map(([id]) => id);
  }

  function positivePortions(portions) {
    return Object.fromEntries(
      Object.entries(portions)
        .filter(([memberId, val]) => editableMemberIds.has(memberId) && Number(val) > 0)
        .map(([id, val]) => [id, Number(val)]),
    );
  }

  function updatePortion(setter, memberId, value) {
    setter((current) => ({ ...current, [memberId]: Math.max(0, Number(value) || 0) }));
  }

  function adjustPortion(setter, memberId, delta) {
    setter((current) => ({ ...current, [memberId]: Math.max(0, taka((Number(current[memberId]) || 0) + delta)) }));
  }

  function setAllPortions(setter, value) {
    const next = {};
    editableMembers.forEach((person) => {
      next[person.id] = value;
    });
    setter(next);
  }

  function setEvenSplit(setter, total) {
    const count = editableMembers.length;
    if (!count) {
      setter({});
      return;
    }

    const baseShare = count > 0 ? taka(Number(total || 0) / count) : 0;
    const next = {};
    editableMembers.forEach((person, index) => {
      next[person.id] = index === count - 1 ? taka(Number(total || 0) - baseShare * (count - 1)) : baseShare;
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
    const portionTotal = sumPortions(portions);
    return {
      boxCount: isAdmin ? portionTotal : 0,
      rate: isAdmin ? Number(rate || settings.mealRate || 70) : Number(settings.mealRate || 70),
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
    setLunchOrdered(getSessionBoxCount(existingDailyMeal.lunch));
    setLunchRate(existingDailyMeal.lunch?.rate || defaultRate);
    setLunchPortions(hydratePortions(existingDailyMeal.lunch?.portions));
    setLunchSkipped(Boolean(existingDailyMeal.lunch?.skipped));
    setDinnerOrdered(getSessionBoxCount(existingDailyMeal.dinner));
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
    setMealFormError("");

    if (isDateBeforeCycle) {
      setIsEditingDay(true);
      setMealFormError(`Meal date cannot be before this cycle started on ${cycleStartDate}.`);
      return;
    }

    const lunchDemandTotal = sumPortions(lunchPortions);
    const dinnerDemandTotal = sumPortions(dinnerPortions);
    const lunchEaters = lunchSkipped ? [] : Object.entries(lunchPortions).filter(([, val]) => Number(val) > 0);
    const dinnerEaters = dinnerSkipped ? [] : Object.entries(dinnerPortions).filter(([, val]) => Number(val) > 0);

    if (!lunchSkipped && !lunchEaters.length && !dinnerSkipped && !dinnerEaters.length) {
      setIsEditingDay(true);
      setMealFormError("Please add lunch or dinner portions for at least one member.");
      return;
    }

    if (isAdmin) {
      if ((!lunchSkipped && lunchEaters.length && Number(lunchOrdered) <= 0) || (!dinnerSkipped && dinnerEaters.length && Number(dinnerOrdered) <= 0)) {
        setIsEditingDay(true);
        setMealFormError("Ordered meals must be greater than zero for sessions that are not marked as skipped.");
        return;
      }

      if ((!lunchSkipped && lunchEaters.length && Math.abs(Number(lunchOrdered) - lunchDemandTotal) > 0.01) || (!dinnerSkipped && dinnerEaters.length && Math.abs(Number(dinnerOrdered) - dinnerDemandTotal) > 0.01)) {
        setIsEditingDay(true);
        setMealFormError("Ordered meals must match the total member demand before saving.");
        return;
      }
    }

    const docId = `${currentCycle.id}_${date}`;
    const payload = {
      cycleId: currentCycle.id,
      date,
      rateMode: getMealRateMode(settings),
      lunch: buildSession(lunchDemandTotal, lunchRate, lunchPortions, lunchSkipped),
      dinner: buildSession(dinnerDemandTotal, dinnerRate, dinnerPortions, dinnerSkipped),
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
      setMealFormError("");
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
              <small>{lunchSkipped ? "No lunch" : `${taka(lunchDemandTotal)} ordered · ${lunchPeople} members`}</small>
            </article>
            <article>
              <span>Dinner</span>
              <strong>{formatTk(dinnerTotal)}</strong>
              <small>{dinnerSkipped ? "No dinner" : `${taka(dinnerDemandTotal)} ordered · ${dinnerPeople} members`}</small>
            </article>
            <article>
              <span>Day total</span>
              <strong>{formatTk(lunchTotal + dinnerTotal)}</strong>
              <small>{taka((lunchSkipped ? 0 : lunchDemandTotal) + (dinnerSkipped ? 0 : dinnerDemandTotal))} ordered meals</small>
            </article>
          </div>

          <div className="meal-session-grid">
            <MealSessionEditor
              activeMembers={editableMembers}
              defaultRate={settings.mealRate || 70}
              disabled={!canEditSheet}
              allowCountEdit={isAdmin}
              allowRateEdit={isAdmin}
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
              setEvenSplit={setEvenSplit}
            />
            <MealSessionEditor
              activeMembers={editableMembers}
              defaultRate={settings.mealRate || 70}
              disabled={!canEditSheet}
              allowCountEdit={isAdmin}
              allowRateEdit={isAdmin}
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
              setEvenSplit={setEvenSplit}
            />
          </div>
          {mealFormError ? <div className="meal-form-error">{mealFormError}</div> : null}
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
  allowCountEdit = true,
  allowRateEdit = true,
  editingRate,
  label,
  ordered,
  portions,
  preview,
  rate,
  setAllPortions,
  setEvenSplit,
  setEditingRate,
  setOrdered,
  setPortions,
  setRate,
  setSkipped,
  skipped,
  updatePortion,
}) {
  const portionControlsDisabled = disabled || skipped;
  const sessionCount = skipped ? 0 : Number(ordered) || 0;
  const rateDisabled = disabled || skipped || !allowRateEdit;
  const totalPortions = skipped ? 0 : taka(Object.values(portions).reduce((sum, value) => sum + Number(value || 0), 0));
  const estimatedTotal = skipped ? 0 : taka(sessionCount * (Number(rate) || 0));
  const activeCount = skipped ? 0 : Object.values(portions).filter((value) => Number(value) > 0).length;

  return (
    <section className={disabled ? "meal-session-box readonly" : skipped ? "meal-session-box skipped" : "meal-session-box"}>
      <div className="meal-session-header">
        <div>
          <h3>{label}</h3>
          <span>{skipped ? `No ${label.toLowerCase()} selected` : `${formatTk(estimatedTotal)} total · ${activeCount} members eating`}</span>
        </div>
        {allowCountEdit ? (
          <>
            <div className="session-controls">
              <label>
                Ordered meals
                <input disabled={portionControlsDisabled} min="0" step="0.5" type="number" value={ordered} onChange={(event) => setOrdered(event.target.value)} />
              </label>
              <label>
                Rate
                <div className={editingRate ? "rate-inline-editor editing" : "rate-inline-editor"}>
                  {editingRate ? (
                    <input
                      autoFocus
                      min="1"
                      type="number"
                      disabled={rateDisabled}
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
                      disabled={rateDisabled}
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
                    <button disabled={rateDisabled} type="button" title="Edit rate" onClick={() => setEditingRate(true)}>
                      <Pencil size={13} />
                    </button>
                  )}
                  <button
                    disabled={rateDisabled}
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
              <button disabled={portionControlsDisabled} type="button" onClick={() => setAllPortions(setPortions, 1)}>All 1</button>
              <button disabled={portionControlsDisabled} type="button" onClick={() => setAllPortions(setPortions, 0.5)}>All 0.5</button>
              <button disabled={portionControlsDisabled} type="button" onClick={() => setEvenSplit(setPortions, ordered)}>Split evenly</button>
              <button disabled={portionControlsDisabled} type="button" onClick={() => setAllPortions(setPortions, 0)}>Clear</button>
            </div>
          </>
        ) : null}
      </div>

      <div className="meal-member-list">
        {activeMembers.map((person) => (
          <div className="meal-member-row" key={person.id}>
            <span>{person.name}</span>
            <div className="portion-controls">
              <button disabled={portionControlsDisabled} type="button" onClick={() => adjustPortion(setPortions, person.id, -0.5)}>-</button>
              <input
                disabled={portionControlsDisabled}
                min="0"
                step="any"
                type="number"
                value={portions[person.id] ?? 0}
                onChange={(event) => updatePortion(setPortions, person.id, event.target.value)}
              />
              <button disabled={portionControlsDisabled} type="button" onClick={() => adjustPortion(setPortions, person.id, 0.5)}>+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="meal-session-summary">
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

function ConfirmModal({ confirmLabel = "Confirm", message, onCancel, onConfirm, open, requiredPhrase = "", title }) {
  const [confirmationText, setConfirmationText] = useState("");
  const requiresPhrase = Boolean(requiredPhrase);
  const canConfirm = !requiresPhrase || confirmationText.trim() === requiredPhrase;

  useEffect(() => {
    if (open) setConfirmationText("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop modal-backdrop--soft" role="presentation">
      <div className="modal-card confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-modal__header">
          <div className="confirm-modal__icon" aria-hidden="true">
            <Shield size={22} />
          </div>
          <div className="modal-heading confirm-modal__heading">
            <span className="eyebrow">Confirmation required</span>
            <h2 id="confirm-title">{title}</h2>
            <p>{message}</p>
          </div>
        </div>
        <div className="confirm-modal__footer">
          <div className="confirm-modal__note">
            <Trash2 size={16} />
            <span>This action needs an explicit confirmation before anything changes.</span>
          </div>
          {requiresPhrase ? (
            <label className="confirm-modal__phrase">
              <span>
                Type <strong>{requiredPhrase}</strong> to continue
              </span>
              <input
                autoFocus
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canConfirm) {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
              />
            </label>
          ) : null}
          <div className="modal-actions confirm-modal__actions">
            <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
            <button className="danger" disabled={!canConfirm} type="button" onClick={onConfirm}>{confirmLabel}</button>
          </div>
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

function Members({ currentCycle, cycleMembers, member, members, setCurrentCycle, setMessage }) {
  const [form, setForm] = useState({ name: "", email: "", role: "member" });
  const [cycleMemberToAdd, setCycleMemberToAdd] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const householdActiveMembers = members.filter((item) => item.active);
  const includedIds = currentCycle?.memberIds || [];
  const availableForCycle = householdActiveMembers.filter((person) => !includedIds.includes(person.id));
  const activeAdminCount = members.filter((person) => person.active && person.role === "admin").length;

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

  async function addMemberToCycle(memberId) {
    const nextMemberIds = [...new Set([...includedIds, memberId])];
    await updateRecord("cycles", currentCycle.id, { memberIds: nextMemberIds });
    setCurrentCycle({ ...currentCycle, memberIds: nextMemberIds });
    setCycleMemberToAdd("");
    setMessage("Member added to this month.");
  }

  async function deleteMemberFromWorkspace() {
    if (!deleteTarget) return;
    if (deleteTarget.role === "admin") {
      setDeleteTarget(null);
      return setMessage("Admin accounts cannot be deleted. Change their role first.");
    }

    const nextMemberIds = includedIds.filter((id) => id !== deleteTarget.id);
    if (nextMemberIds.length !== includedIds.length) {
      await updateRecord("cycles", currentCycle.id, { memberIds: nextMemberIds });
      setCurrentCycle({ ...currentCycle, memberIds: nextMemberIds });
    }

    await deleteRecord("members", deleteTarget.id);
    setDeleteTarget(null);
    setMessage("Member deleted from workspace.");
  }

  async function changeMemberRole(person, role) {
    if (person.role === "admin" && role !== "admin" && activeAdminCount <= 1) {
      return setMessage("There must always be at least one active admin.");
    }
    await updateRecord("members", person.id, { role });
  }

  async function toggleMemberActive(person) {
    if (person.active && person.role === "admin" && activeAdminCount <= 1) {
      return setMessage("There must always be at least one active admin.");
    }
    await updateRecord("members", person.id, { active: !person.active });
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
          <p>Manage role, access status, and who is counted in the current month.</p>
        </div>
        <div className="cycle-member-manager">
          <div className="cycle-member-manager__header">
            <div>
              <span className="eyebrow">Current cycle</span>
              <p>Only these members are counted in meals, deposits, and balances.</p>
            </div>
            <span className="cycle-member-count">{includedIds.length} selected</span>
          </div>
          <div className="cycle-member-pills">
            {cycleMembers.map((person) => (
              <span key={person.id}>{person.name}</span>
            ))}
          </div>
          {availableForCycle.length ? (
            <div className="cycle-member-add">
              <label>
                Add member
                <select value={cycleMemberToAdd} onChange={(event) => setCycleMemberToAdd(event.target.value)}>
                  <option value="">Choose someone</option>
                  {availableForCycle.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </label>
              <button className="secondary" disabled={!cycleMemberToAdd} type="button" onClick={() => addMemberToCycle(cycleMemberToAdd)}>
                <Plus size={16} /> Add to month
              </button>
            </div>
          ) : (
            <p className="cycle-member-complete">All active household members are already included this month.</p>
          )}
        </div>
        <div className="entry-list">
          {members.map((person) => (
            <article className="entry-row member-row" key={person.id}>
              <div className="member-row__info">
                <MemberNameEditor person={person} setMessage={setMessage} />
                <span>{person.email}</span>
                <small>
                  {person.role} · {person.active ? "active" : "inactive"}
                </small>
              </div>
              <div className="member-row__actions">
                <select value={person.role} onChange={(event) => changeMemberRole(person, event.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="secondary" onClick={() => toggleMemberActive(person)}>
                  {person.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  className="delete-member-button"
                  disabled={person.role === "admin"}
                  title={person.role === "admin" ? "Admin accounts cannot be deleted while they are admin" : "Delete member"}
                  onClick={() => setDeleteTarget(person)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <ConfirmModal
        confirmLabel="Delete member"
        message={deleteTarget ? `${deleteTarget.name} will be removed from the workspace and from this month. Existing historical entries are not edited.` : ""}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteMemberFromWorkspace}
        open={Boolean(deleteTarget)}
        title="Delete member from workspace?"
      />
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

function History({ cycles, onSelectCycle, selectedCycleId }) {
  const closed = cycles.filter((cycle) => cycle.status === "closed");
  const selectedCycle = closed.find((cycle) => cycle.id === selectedCycleId) || closed[0] || null;
  const cycleMeals = selectedCycle?.snapshot?.meals || [];
  const cycleExpenses = selectedCycle?.snapshot?.expenses || [];
  const cycleDeposits = selectedCycle?.snapshot?.deposits || [];
  const dates = cycleMeals.reduce((acc, entry) => {
    const bucket = acc[entry.date] || { date: entry.date, meals: [], mealTotal: 0, expenseTotal: 0, depositTotal: 0 };
    bucket.meals.push(entry);
    bucket.mealTotal = taka(bucket.mealTotal + Number(entry.boxCount || 0) * Number(entry.rate || 0));
    acc[entry.date] = bucket;
    return acc;
  }, {});

  cycleExpenses.forEach((expense) => {
    const bucket = dates[expense.date] || { date: expense.date, meals: [], mealTotal: 0, expenseTotal: 0, depositTotal: 0 };
    bucket.expenseTotal = taka(bucket.expenseTotal + Number(expense.amount || 0));
    dates[expense.date] = bucket;
  });

  cycleDeposits.forEach((deposit) => {
    const bucket = dates[deposit.date] || { date: deposit.date, meals: [], mealTotal: 0, expenseTotal: 0, depositTotal: 0 };
    bucket.depositTotal = taka(bucket.depositTotal + Number(deposit.amount || 0));
    dates[deposit.date] = bucket;
  });

  const sortedDates = Object.values(dates).sort((left, right) => String(left.date).localeCompare(String(right.date)));

  return (
    <section className="panel history-panel">
      <div className="section-heading">
        <span className="eyebrow">Archive</span>
        <h2>Closed cycles</h2>
        <p>Each closed cycle keeps a balance snapshot with per-member meals, deposits, costs, and balance.</p>
      </div>
      {selectedCycle ? (
        <div className="history-item history-item--detail">
          <div className="history-item__header">
            <div>
              <strong>{selectedCycle.name || `${selectedCycle.startDate} to ${selectedCycle.endDate || "closing"}`}</strong>
              <span>{selectedCycle.startDate} to {selectedCycle.endDate || "closed"}</span>
            </div>
            {closed.length > 1 ? (
              <select value={selectedCycle.id} onChange={(event) => onSelectCycle?.(event.target.value)}>
                {closed.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name || `${cycle.startDate} to ${cycle.endDate || "closing"}`}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="history-kpis">
            <article>
              <span>Total meals</span>
              <strong>{formatTk(selectedCycle.snapshot?.totals?.meals || 0)}</strong>
            </article>
            <article>
              <span>Total deposits</span>
              <strong>{formatTk(selectedCycle.snapshot?.totals?.deposits || 0)}</strong>
            </article>
            <article>
              <span>Total expenses</span>
              <strong>{formatTk(selectedCycle.snapshot?.totals?.expenses || 0)}</strong>
            </article>
            <article>
              <span>Meal rate</span>
              <strong>{formatTk(selectedCycle.snapshot?.totals?.calculatedMealRate || selectedCycle.snapshot?.totals?.defaultMealRate || 0)}</strong>
            </article>
          </div>

          <div className="history-members">
            {sortedDates.length ? sortedDates.map((day) => (
              <div className="history-member-row" key={day.date}>
                <div className="history-member-row__name">
                  <strong>{day.date}</strong>
                  <span>{day.meals.length} meal entr{day.meals.length === 1 ? "y" : "ies"}</span>
                </div>
                <div className="history-member-row__metrics">
                  <span><em>Meal total</em>{formatTk(day.mealTotal)}</span>
                  <span><em>Expenses</em>{formatTk(day.expenseTotal)}</span>
                  <span><em>Deposits</em>{formatTk(day.depositTotal)}</span>
                </div>
                <div className="history-member-row__metrics">
                  {day.meals.map((entry) => (
                    <span key={entry.id}><em>{entry.session}</em>{entry.boxCount} ordered · {formatTk(entry.rate)} rate</span>
                  ))}
                </div>
              </div>
            )) : <p className="empty">This cycle has no stored date-level entries.</p>}
          </div>
        </div>
      ) : null}
      <div className="history-grid">
        {closed.map((cycle) => (
          <article className={cycle.id === selectedCycle?.id ? "history-item active" : "history-item"} key={cycle.id} onClick={() => onSelectCycle?.(cycle.id)} role="button" tabIndex={0}>
            <div className="history-item__header">
              <div>
                <strong>{cycle.name || `${cycle.startDate} to ${cycle.endDate || "closing"}`}</strong>
                <span>{cycle.startDate} to {cycle.endDate || "closed"}</span>
              </div>
              <span className="history-status">Closed</span>
            </div>

            <div className="history-kpis">
              <article>
                <span>Total meals</span>
                <strong>{formatTk(cycle.snapshot?.totals?.meals || 0)}</strong>
              </article>
              <article>
                <span>Total deposits</span>
                <strong>{formatTk(cycle.snapshot?.totals?.deposits || 0)}</strong>
              </article>
              <article>
                <span>Total expenses</span>
                <strong>{formatTk(cycle.snapshot?.totals?.expenses || 0)}</strong>
              </article>
              <article>
                <span>Meal rate</span>
                <strong>{formatTk(cycle.snapshot?.totals?.calculatedMealRate || cycle.snapshot?.totals?.defaultMealRate || 0)}</strong>
              </article>
            </div>

            <div className="history-members">
              {Object.values(cycle.snapshot?.ledger || {}).map((row) => (
                <div className="history-member-row" key={row.memberId}>
                  <div className="history-member-row__name">
                    <strong>{row.name}</strong>
                    <span>{row.balance >= 0 ? "In credit" : "Needs settlement"}</span>
                  </div>
                  <div className="history-member-row__metrics">
                    <span><em>Meals</em>{Number(row.mealCount || 0).toFixed(1)}</span>
                    <span><em>Deposits</em>{formatTk(row.deposits || 0)}</span>
                    <span><em>Meal cost</em>{formatTk(row.mealCost || 0)}</span>
                    <span><em>Expense share</em>{formatTk(row.expenseCost || 0)}</span>
                    <span><em>Balance</em>{formatTk(row.balance || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
        {!closed.length ? <p className="empty">No closed cycles yet.</p> : null}
      </div>
    </section>
  );
}
