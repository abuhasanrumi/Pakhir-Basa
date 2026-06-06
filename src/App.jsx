import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import {
  Banknote,
  CalendarCheck,
  Check,
  CircleDollarSign,
  Copy,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { identifyAnalyticsUser, trackEvent, trackFormError, trackPageView } from "./analytics";
import {
  addRecord,
  auth,
  createInvite,
  createMess,
  db,
  deleteRecord,
  getMemberships,
  getMess,
  getOpenCycle,
  hasFirebaseConfig,
  joinInvite,
  setRecord,
  signInWithGoogle,
  signOutUser,
  updateRecord,
} from "./firebase";
import { buildCycleSnapshot, calculateLedger, getCalculatedMealRate, getMealEntryRate, getMealRateMode, splitMeal, taka } from "./lib/calculations";

const today = () => new Date().toISOString().slice(0, 10);
const OFFLINE_NOTICE = "You’re offline, so this is the last saved version. You can edit again once you’re back online.";
const CACHE_PREFIX = "pakhir-basa";

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

function formatDisplayDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const day = parsed.toLocaleDateString("en", { day: "numeric" });
  const month = parsed.toLocaleDateString("en", { month: "long" });
  const year = parsed.toLocaleDateString("en", { year: "numeric" });
  return `${day} ${month}, ${year}`;
}

function formatDisplayDateRange(startDate, endDate, fallback = "closing") {
  return `${formatDisplayDate(startDate)} to ${endDate ? formatDisplayDate(endDate) : fallback}`;
}

function isTodayDate(date) {
  return date === today();
}

function isBeforeDate(date, minDate) {
  return Boolean(date && minDate && date < minDate);
}

function DateInput({ disabled = false, label = "Date", min, onChange, showToday = false, value }) {
  return (
    <div className="pretty-date-control">
      <input className="pretty-date-display" readOnly value={formatDisplayDate(value)} />
      {showToday && isTodayDate(value) ? <span className="today-chip">Today</span> : null}
      <CalendarCheck className="pretty-date-icon" size={18} />
      <input
        aria-label={label}
        className="native-date-picker"
        disabled={disabled}
        min={min}
        type="date"
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function cacheKey(name) {
  return `${CACHE_PREFIX}:${name}`;
}

function readLocalCache(name, fallback = null) {
  try {
    const item = window.localStorage.getItem(cacheKey(name));
    if (!item) return fallback;
    const parsed = JSON.parse(item);
    return parsed?.value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocalCache(name, value) {
  try {
    window.localStorage.setItem(cacheKey(name), JSON.stringify({ cachedAt: new Date().toISOString(), value }));
  } catch {
    // Local cache is a convenience only; the server remains the source of truth.
  }
}

async function copyToClipboard(text) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function trackedSignOut() {
  trackEvent("sign_out_clicked");
  await signOutUser();
}

function collectionCacheName(collectionName, options = {}) {
  return [
    "collection",
    collectionName,
    options.messId || "global",
    options.cycleId || "all",
    options.orderBy || "none",
    options.orderDirection || "asc",
  ].join(":");
}

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    function updateOnlineStatus() {
      const nextOnline = navigator.onLine;
      setIsOnline(nextOnline);
      trackEvent(nextOnline ? "connection_restored" : "offline_mode_entered");
    }

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  function retryConnection() {
    setIsOnline(navigator.onLine);
    setRetryToken((current) => current + 1);
    trackEvent("offline_retry_clicked", { is_online: navigator.onLine });
  }

  return { isOnline, retryConnection, retryToken };
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
        submittedBy: day.submittedBy || day.createdBy,
        submittedByName: day.submittedByName || day.createdByName,
      }];
    }),
  );
}

async function enrichMembershipsWithMessNames(memberships = []) {
  return Promise.all(
    memberships.map(async (membership) => {
      if (membership.messName) return membership;
      const mess = await getMess(membership.messId);
      return { ...membership, messName: mess?.name || membership.messName || "Unnamed mess" };
    }),
  );
}

function useCollection(collectionName, options = {}) {
  const cacheName = collectionCacheName(collectionName, options);
  const [rows, setRows] = useState(() => readLocalCache(cacheName, []));
  const [loading, setLoading] = useState(true);
  const [serverSynced, setServerSynced] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cachedRows = readLocalCache(cacheName, []);
    setRows(cachedRows);
    setServerSynced(false);
    setError(null);

    if (!db || options.skip) {
      setRows([]);
      setLoading(false);
      setServerSynced(true);
      return undefined;
    }

    const clauses = [];
    if (options.messId) clauses.push(where("messId", "==", options.messId));
    if (options.cycleId) clauses.push(where("cycleId", "==", options.cycleId));
    if (options.orderBy && !options.cycleId && !options.messId) clauses.push(orderBy(options.orderBy, options.orderDirection || "asc"));
    const q = clauses.length ? query(collection(db, collectionName), ...clauses) : collection(db, collectionName);

    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const nextRows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
        if (options.orderBy && (options.cycleId || options.messId)) {
          nextRows.sort((a, b) => {
            const left = a[options.orderBy] || "";
            const right = b[options.orderBy] || "";
            return options.orderDirection === "desc" ? String(right).localeCompare(String(left)) : String(left).localeCompare(String(right));
          });
        }
        setRows(nextRows);
        if (!snap.metadata.fromCache) {
          writeLocalCache(cacheName, nextRows);
          setServerSynced(true);
        }
        setLoading(false);
      },
      (snapshotError) => {
        console.error(`${collectionName} listener failed`, snapshotError);
        setError(snapshotError);
        setRows(cachedRows);
        setLoading(false);
      },
    );
  }, [cacheName, collectionName, options.cycleId, options.messId, options.orderBy, options.orderDirection, options.retryToken, options.skip]);

  return { rows, error, loading, serverSynced };
}

export function App() {
  const [user, setUser] = useState(null);
  const [member, setMember] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [currentMess, setCurrentMess] = useState(null);
  const [currentCycle, setCurrentCycle] = useState(null);
  const [selectedHistoryCycleId, setSelectedHistoryCycleId] = useState("");
  const [activeView, setActiveView] = useState("dashboard");
  const [depositDefaultAction, setDepositDefaultAction] = useState("deposit");
  const [depositScrollRequest, setDepositScrollRequest] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [syncGateExpired, setSyncGateExpired] = useState(false);
  const [message, setMessage] = useState("");
  const { isOnline, retryConnection, retryToken } = useOnlineStatus();
  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get("invite") || "", []);

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
        setMemberships([]);
        setCurrentMess(null);
        setCurrentCycle(null);
        setBootstrapping(true);
        setMessage("");

        if (!nextUser?.email) {
          setBootstrapping(false);
          return;
        }

        trackEvent("sign_in_completed", { provider: "google", has_invite: Boolean(inviteToken) });
        const email = nextUser.email.toLowerCase();
        const cachedSession = readLocalCache(`session:${email}`, null);
        let joinedMember = null;
        if (inviteToken) {
          joinedMember = await joinInvite({ token: inviteToken, user: nextUser });
          trackEvent("invite_accepted", { role: joinedMember.role });
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        const appMemberships = await getMemberships(email);
        const nextMemberships = await enrichMembershipsWithMessNames(joinedMember && !appMemberships.some((item) => item.id === joinedMember.id) ? [joinedMember, ...appMemberships] : appMemberships);
        const preferredMessId = joinedMember?.messId || cachedSession?.mess?.id || nextMemberships[0]?.messId || "";
        const appMember = nextMemberships.find((item) => item.messId === preferredMessId) || nextMemberships[0] || null;

        if (appMember?.active) {
          const mess = await getMess(appMember.messId);
          const openCycle = await getOpenCycle(appMember.messId);
          setMemberships(nextMemberships);
          setCurrentMess(mess);
          setMember(appMember);
          setCurrentCycle(openCycle);
          setSelectedHistoryCycleId("");
          setMobileSidebarOpen(false);
          writeLocalCache(`session:${email}`, { currentCycle: openCycle, member: appMember, memberships: nextMemberships, mess });
          trackEvent("mess_session_loaded", {
            role: appMember.role,
            mess_count: nextMemberships.length,
            has_open_cycle: Boolean(openCycle),
          });
        } else if (!navigator.onLine && cachedSession?.member?.active) {
          setMemberships(cachedSession.memberships || [cachedSession.member]);
          setCurrentMess(cachedSession.mess || null);
          setMember(cachedSession.member);
          setCurrentCycle(cachedSession.currentCycle || null);
          setSelectedHistoryCycleId("");
          setMobileSidebarOpen(false);
          trackEvent("cached_session_loaded", { has_open_cycle: Boolean(cachedSession.currentCycle) });
        }

        setBootstrapping(false);
      } catch (error) {
        console.error("Firebase setup failed", error);
        const email = nextUser?.email?.toLowerCase();
        const cachedSession = email ? readLocalCache(`session:${email}`, null) : null;
        if (!navigator.onLine && cachedSession?.member?.active) {
          setMemberships(cachedSession.memberships || [cachedSession.member]);
          setCurrentMess(cachedSession.mess || null);
          setMember(cachedSession.member);
          setCurrentCycle(cachedSession.currentCycle || null);
          setSelectedHistoryCycleId("");
          setMobileSidebarOpen(false);
          setMessage("");
        } else {
          setMessage(error.code === "permission-denied" ? "Couldn’t open your mess yet. Please sign out and try again." : error.message);
          trackEvent("app_bootstrap_failed", { error_code: error.code || "unknown" });
        }
        setBootstrapping(false);
      }
    });
  }, []);

  const isAdmin = member?.role === "admin";
  const messId = currentMess?.id || member?.messId || "";
  const { rows: members, serverSynced: membersSynced } = useCollection("members", { messId, orderBy: "name", retryToken, skip: !member || !messId });
  const { rows: cycles, serverSynced: cyclesSynced } = useCollection("cycles", { messId, orderBy: "startDate", orderDirection: "desc", retryToken, skip: !member || !messId });
  useEffect(() => {
    const openCycle = cycles.find((cycle) => cycle.status === "open");
    setCurrentCycle((existingCycle) => openCycle || (!isOnline && existingCycle?.status === "open" ? existingCycle : null));
  }, [cycles, isOnline]);

  const { rows: dailyMeals, serverSynced: dailyMealsSynced } = useCollection("dailyMeals", { cycleId: currentCycle?.id, messId, orderBy: "date", retryToken, skip: !currentCycle || !messId });
  const mealEntries = useMemo(() => flattenDailyMeals(dailyMeals), [dailyMeals]);
  const { rows: expenses, serverSynced: expensesSynced } = useCollection("expenses", { cycleId: currentCycle?.id, messId, orderBy: "date", retryToken, skip: !currentCycle || !messId });
  const { rows: deposits, serverSynced: depositsSynced } = useCollection("deposits", { cycleId: currentCycle?.id, messId, orderBy: "date", retryToken, skip: !currentCycle || !messId });
  const { rows: settingsRows, serverSynced: settingsSynced } = useCollection("settings", { messId, retryToken, skip: !member || !messId });
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
  const baseServerSynced = membersSynced && cyclesSynced && settingsSynced;
  const cycleServerSynced = !currentCycle || (dailyMealsSynced && depositsSynced && (!isCalculatedMonth || expensesSynced));
  const serverDataReady = isOnline && baseServerSynced && cycleServerSynced;
  const editingDataReady = serverDataReady || syncGateExpired;
  const readOnlyMode = Boolean(member) && (!isOnline || !editingDataReady);

  useEffect(() => {
    setSyncGateExpired(false);
    if (!member || !isOnline || serverDataReady) return undefined;
    const timeoutId = window.setTimeout(() => {
      setSyncGateExpired(true);
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [currentCycle?.id, isOnline, member?.id, messId, retryToken, serverDataReady]);

  useEffect(() => {
    if (!member?.email || !serverDataReady) return;
    writeLocalCache(`session:${member.email.toLowerCase()}`, { currentCycle, member, memberships, mess: currentMess });
  }, [currentCycle, currentMess, member, memberships, serverDataReady]);

  useEffect(() => {
    if (!readOnlyMode) return undefined;

    const selector = [
      ".main input",
      ".main select",
      ".main textarea",
      ".main form button",
      ".main .primary",
      ".main .danger",
      ".main .approve",
      ".main .danger-icon",
      ".main .approve-text-button",
      ".main .delete-member-button",
      ".main .close-cycle-button",
    ].join(",");
    const controls = Array.from(document.querySelectorAll(selector)).filter((control) => !control.closest("[data-offline-allowed='true']") && !control.matches("[data-offline-allowed='true']") && !control.classList.contains("calendar-day"));
    const previousStates = controls.map((control) => [control, control.disabled]);
    controls.forEach((control) => {
      control.disabled = true;
    });

    function blockSubmit(event) {
      if (event.target.closest("[data-offline-allowed='true']")) return;
      event.preventDefault();
      event.stopPropagation();
    }

    document.addEventListener("submit", blockSubmit, true);
    return () => {
      previousStates.forEach(([control, wasDisabled]) => {
        control.disabled = wasDisabled;
      });
      document.removeEventListener("submit", blockSubmit, true);
    };
  }, [activeView, readOnlyMode, selectedHistoryCycleId, currentCycle?.id, dailyMeals.length, expenses.length, deposits.length, members.length]);

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
      (isCalculatedMonth
        ? expenses.filter((expense) => expense.status === "pending").length
        : expenses.filter((expense) => expense.status === "pending" && expense.category === "meal" && expense.payerId === "mess_cash").length) +
      deposits.filter((d) => d.status === "pending").length,
    [dailyMeals, expenses, deposits, isCalculatedMonth],
  );

  useEffect(() => {
    identifyAnalyticsUser(member, {
      messCount: memberships.length,
      hasOpenCycle: Boolean(currentCycle),
      mealRateMode: settings.mealRateMode,
    });
  }, [currentCycle?.id, member?.id, member?.role, memberships.length, settings.mealRateMode]);

  useEffect(() => {
    if (!user) {
      trackPageView("login");
      return;
    }
    if (!member) {
      trackPageView("mess_setup", { has_invite: Boolean(inviteToken) });
      return;
    }
    trackPageView(activeView, {
      role: member.role,
      has_open_cycle: Boolean(currentCycle),
      meal_rate_mode: settings.mealRateMode,
      read_only: readOnlyMode,
      pending_count: pendingCount,
    });
  }, [activeView, currentCycle?.id, inviteToken, member?.id, member?.role, pendingCount, readOnlyMode, settings.mealRateMode, user?.uid]);

  useEffect(() => {
    if (serverDataReady) trackEvent("server_data_ready", { has_open_cycle: Boolean(currentCycle), meal_rate_mode: settings.mealRateMode });
  }, [currentCycle?.id, serverDataReady, settings.mealRateMode]);

  useEffect(() => {
    if (readOnlyMode) trackEvent("read_only_mode_enabled", { is_online: isOnline, has_open_cycle: Boolean(currentCycle) });
  }, [currentCycle?.id, isOnline, readOnlyMode]);

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

    const approvedMessCashSpending = expenses.filter((e) => e.status === "approved" && e.payerId === "mess_cash");
    const totalMessCashSpending = approvedMessCashSpending.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    return taka(totalDeposits - totalMessCashSpending);
  }, [deposits, expenses]);

  async function switchMess(memberIdToSelect) {
    const nextMember = memberships.find((item) => item.id === memberIdToSelect);
    if (!nextMember) return;
    const mess = await getMess(nextMember.messId);
    const openCycle = await getOpenCycle(nextMember.messId);
    const memberWithName = { ...nextMember, messName: mess?.name || nextMember.messName || "Unnamed mess" };
    setMember(memberWithName);
    setCurrentMess(mess);
    setCurrentCycle(openCycle);
    setMemberships((current) => current.map((item) => item.id === memberWithName.id ? memberWithName : item));
    setActiveView("dashboard");
    setSelectedHistoryCycleId("");
    setMobileSidebarOpen(false);
    trackEvent("mess_switched", {
      role: memberWithName.role,
      mess_count: memberships.length,
      has_open_cycle: Boolean(openCycle),
    });
  }

  async function createAnotherMess(name) {
    if (!user) return;
    const { mess, member: createdMember } = await createMess({ name, user });
    const memberWithName = { ...createdMember, messName: mess.name };
    setMember(memberWithName);
    setCurrentMess(mess);
    setCurrentCycle(null);
    setMemberships((current) => [memberWithName, ...current.filter((item) => item.id !== memberWithName.id)]);
    setActiveView("dashboard");
    setSelectedHistoryCycleId("");
    setMobileSidebarOpen(false);
    setMessage(`Created ${mess.name}. You’re the admin here.`);
    trackEvent("mess_created_from_switcher", { mess_count: memberships.length + 1 });
  }

  if (!hasFirebaseConfig) return <SetupScreen />;
  if (bootstrapping) return <Shell message="Loading household data..." />;
  if (!user) return <LoginScreen />;
  if (!member) {
    return (
      <MessSetupScreen
        inviteToken={inviteToken}
        message={message}
        setCurrentMess={setCurrentMess}
        setMember={setMember}
        setMemberships={setMemberships}
        setMessage={setMessage}
        user={user}
      />
    );
  }
  if (!currentCycle) {
    return (
      <NoCycleScreen
        currentMess={currentMess}
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
        memberships={memberships}
        onCreateMess={createAnotherMess}
        onSwitchMess={switchMess}
        user={user}
        isOnline={isOnline}
        onRetryConnection={retryConnection}
        readOnlyMode={readOnlyMode}
        serverDataReady={serverDataReady}
      />
    );
  }

  const navigation = [
    { id: "dashboard", label: "Home", icon: CalendarCheck },
    { id: "meals", label: "Meals", icon: Soup },
    { id: "expenses", label: "Expenses", icon: ReceiptText, calculatedOnly: true },
    { id: "deposits", label: "Deposits", icon: Wallet },
    { id: "members", label: "People", icon: Users, adminOnly: true },
    { id: "history", label: "Old Months", icon: Banknote },
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
            <strong>{currentMess?.name || "Pakhir Basa"}</strong>
            <span>Meal Tracker</span>
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
                  if (item.id === "deposits") setDepositDefaultAction("deposit");
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

        <MessSwitcher currentMemberId={member.id} currentMess={currentMess} memberships={memberships} onCreateMess={createAnotherMess} onSwitchMess={switchMess} readOnly={readOnlyMode} />

        <div className="profile">
          <img src={user.photoURL} alt="" />
          <div>
            <strong>{member.name}</strong>
            <span>{member.role}</span>
          </div>
          <button className="icon-button" title="Sign out" onClick={trackedSignOut}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-brand">
            <div className="topbar-logo">PB</div>
            <div>
              <strong>{currentMess?.name || "Pakhir Basa"}</strong>
              <span>Meal Tracker</span>
            </div>
          </div>
          <div className="topbar-page-title">
            <p>{currentCycle?.name || "This month"}</p>
            <h1>{navigation.find((item) => item.id === activeView)?.label || "Dashboard"}</h1>
          </div>
          {/* <div className="top-actions">
            <span className="status-pill">
              {getMealRateMode(settings) === "calculated" ? "Calculated month: " : "Static month: "}
              {formatTk(totals.mealRate)}
            </span>
          </div> */}
        </header>

        {readOnlyMode ? <OfflineBanner isOnline={isOnline} onRetry={retryConnection} serverDataReady={serverDataReady} /> : null}
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
            member={member}
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
            setDepositDefaultAction={setDepositDefaultAction}
            setDepositScrollRequest={setDepositScrollRequest}
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
            defaultAction={depositDefaultAction}
            merchantScrollRequest={depositScrollRequest}
            onMerchantScrollConsumed={() => setDepositScrollRequest(0)}
            expenses={expenses}
            isAdmin={isAdmin}
            member={member}
            setMessage={setMessage}
          />
        ) : null}
        {activeView === "members" && isAdmin ? <Members currentCycle={currentCycle} currentMess={currentMess} cycleMembers={activeMembers} member={member} members={members} setCurrentCycle={setCurrentCycle} setMessage={setMessage} /> : null}
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
      <button className="secondary" onClick={trackedSignOut}>
        Sign out
      </button>
    </div>
  );
}

function OfflineBanner({ isOnline, onRetry, serverDataReady }) {
  return (
    <div className={isOnline ? "offline-banner syncing" : "offline-banner"} role="status">
      <div>
        <strong>{isOnline && !serverDataReady ? "Getting the latest meals" : "You’re offline"}</strong>
        <p>
          {isOnline && !serverDataReady
            ? "Hold on a moment while we check for the newest changes."
            : OFFLINE_NOTICE}
        </p>
      </div>
      <button className="secondary" data-offline-allowed="true" type="button" onClick={onRetry}>
        <RotateCcw size={16} /> Try again
      </button>
    </div>
  );
}

function MessSwitcher({ currentMemberId, currentMess, memberships, onCreateMess, onSwitchMess, readOnly = false }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [messName, setMessName] = useState("My New Mess");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const currentMembership = memberships.find((item) => item.id === currentMemberId);

  async function submitNewMess(event) {
    event.preventDefault();
    if (!onCreateMess || saving) return;
    try {
      setSaving(true);
      setError("");
      await onCreateMess(messName.trim() || "My New Mess");
      setCreating(false);
      setOpen(false);
      setMessName("My New Mess");
    } catch (createError) {
      setError(createError.message || "Couldn’t create the mess. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mess-quick-switch">
      <div className="mess-quick-switch__copy">
        <span>Mess</span>
        <strong>{currentMess?.name || currentMembership?.messName || "This mess"}</strong>
      </div>
      <button className="mess-icon-button" disabled={readOnly} title="Switch or create mess" type="button" onClick={() => setOpen(true)}>
        <Users size={17} />
      </button>
      {open ? (
        <div className="modal-backdrop modal-backdrop--soft" role="presentation" onMouseDown={() => setOpen(false)}>
          <div className="modal-card mess-switch-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading mess-switch-modal__heading">
              <div>
                <h2>Your messes</h2>
                <p>Pick where you want to work now.</p>
              </div>
              <button className="icon-button mess-switch-modal__close" type="button" title="Close" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="mess-current-strip">
              <span>Current</span>
              <strong>{currentMess?.name || currentMembership?.messName || "This mess"}</strong>
            </div>
            <div className="mess-choice-list">
              {memberships.map((membership) => (
                <button
                  className={membership.id === currentMemberId ? "mess-choice active" : "mess-choice"}
                  disabled={membership.id === currentMemberId}
                  key={membership.id}
                  type="button"
                  onClick={async () => {
                    await onSwitchMess(membership.id);
                    setOpen(false);
                  }}
                >
                  <span className="mess-choice__mark">
                    {membership.id === currentMemberId ? <Check size={17} /> : <Users size={17} />}
                  </span>
                  <div>
                    <strong>{membership.messName || "Unnamed mess"}</strong>
                    <span>{membership.role === "admin" ? "Admin access" : "Member access"}</span>
                  </div>
                  {membership.id === currentMemberId ? <small>Active</small> : <small>Open</small>}
                </button>
              ))}
            </div>
            {creating ? (
              <form className="mess-create-inline" onSubmit={submitNewMess}>
                <label>
                  Mess name
                  <input autoFocus value={messName} onChange={(event) => setMessName(event.target.value)} />
                </label>
                {error ? <p className="modal-error">{error}</p> : null}
                <div className="modal-actions">
                  <button className="secondary" disabled={saving} type="button" onClick={() => setCreating(false)}>Cancel</button>
                  <button className="primary" disabled={saving} type="submit">
                    <Plus size={18} /> {saving ? "Creating..." : "Create mess"}
                  </button>
                </div>
              </form>
            ) : (
              <button className="mess-create-wide" type="button" onClick={() => setCreating(true)}>
                <span><Plus size={18} /></span>
                <div>
                  <strong>Create another mess</strong>
                  <small>You’ll be admin of the new mess.</small>
                </div>
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LoginScreen() {
  async function handleSignIn() {
    trackEvent("sign_in_clicked", { provider: "google" });
    try {
      await signInWithGoogle();
    } catch (error) {
      trackEvent("sign_in_failed", { provider: "google", error_code: error.code || "unknown" });
      console.error("Sign in failed", error);
    }
  }

  return (
    <div className="login-screen">
      <section className="login-hero">
        <div>
          <p>House meal tracker</p>
          <h1>Pakhir Basa Meal Tracker</h1>
          <span>Keep meals, bazaar, deposits, and balances easy for everyone.</span>
        </div>
      </section>
      <section className="login-panel">
        <Soup size={36} />
        <h2>Come on in</h2>
        <p>Sign in with Google to open your mess account.</p>
        <button className="primary" onClick={handleSignIn}>
          Continue with Google
        </button>
      </section>
    </div>
  );
}

function MessSetupScreen({ inviteToken, message, setCurrentMess, setMember, setMemberships, setMessage, user }) {
  const [messName, setMessName] = useState("My Mess");
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleCreateMess(event) {
    event.preventDefault();
    try {
      setCreating(true);
      const { mess, member: createdMember } = await createMess({ name: messName, user });
      setCurrentMess(mess);
      setMember(createdMember);
      setMemberships([createdMember]);
      setMessage("Mess created. You’re the admin for this mess.");
      trackEvent("mess_created", { source: inviteToken ? "invite_screen" : "setup_screen" });
    } catch (error) {
      trackEvent("mess_create_failed", { error_code: error.code || "unknown" });
      setMessage(error.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinInvite() {
    if (!inviteToken) return;
    try {
      setJoining(true);
      const joinedMember = await joinInvite({ token: inviteToken, user });
      const mess = await getMess(joinedMember.messId);
      setCurrentMess(mess);
      setMember(joinedMember);
      setMemberships([joinedMember]);
      window.history.replaceState({}, document.title, window.location.pathname);
      setMessage(`Joined ${mess?.name || "mess"}.`);
      trackEvent("invite_joined_from_setup", { role: joinedMember.role });
    } catch (error) {
      trackEvent("invite_join_failed", { error_code: error.code || "unknown" });
      setMessage(error.message);
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="center-screen setup">
      <div className="setup-card mess-setup-card">
        <div className="loading-brand">
          <div className="loading-brand__mark">PB</div>
          <div>
            <strong>Pakhir Basa</strong>
            <span>Meal Tracker</span>
          </div>
        </div>
        <div>
          <h1>Start or join a mess</h1>
          <p>Create your own mess, or join one with an invite link from a housemate.</p>
        </div>
        {message ? <div className="notice">{message}</div> : null}
        {inviteToken ? (
          <button className="primary" disabled={joining} type="button" onClick={handleJoinInvite}>
            <Check size={18} /> {joining ? "Joining..." : "Join from invite"}
          </button>
        ) : null}
        <form className="form-grid" onSubmit={handleCreateMess}>
          <label>
            Mess name
            <input value={messName} onChange={(event) => setMessName(event.target.value)} />
          </label>
          <button className="primary" disabled={creating} type="submit">
            <Plus size={18} /> {creating ? "Creating..." : "Start a new mess"}
          </button>
        </form>
        <button className="secondary" type="button" onClick={trackedSignOut}>
          Sign out
        </button>
      </div>
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
            <span>Meal Tracker</span>
          </div>
        </div>
        <div className="loading-orbit" aria-hidden="true">
          <Soup size={30} />
        </div>
        <div className="loading-copy">
          <span className="eyebrow">Getting things ready</span>
        </div>
        <div className="loading-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}

function NoCycleScreen({ currentMess, cycles, isAdmin, isOnline, member, memberships, members, onCreateMess, onRetryConnection, onSwitchMess, readOnlyMode, selectedHistoryCycleId, serverDataReady, setCurrentCycle, setMessage, setMobileSidebarOpen, setSelectedHistoryCycleId, sidebarOpen, user }) {
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
    if (!form.memberIds.length) {
      trackFormError("start_cycle", "no_members");
      return setMessage("Pick at least one person for this month.");
    }
    const activeMessId = currentMess?.id || member.messId;
    const cycle = {
      messId: activeMessId,
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
      doc(db, "settings", `${activeMessId}_main`),
      {
        messId: activeMessId,
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
    trackEvent("cycle_created", {
      meal_rate_mode: cycle.mealRateMode,
      member_count: cycle.memberIds.length,
      meal_rate: cycle.mealRate,
    });
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
            <strong>{currentMess?.name || "Pakhir Basa"}</strong>
            <span>Meal Tracker</span>
          </div>
        </div>
        {isAdmin ? (
          <nav className="nav no-cycle-nav">
            <button className={sidebarView === "create" ? "nav-item active" : "nav-item"} onClick={() => { setSidebarView("create"); setMobileSidebarOpen(false); }}>
              <Plus size={18} />
              <span>New month</span>
            </button>
            <button className={sidebarView === "history" ? "nav-item active" : "nav-item"} onClick={() => { setSidebarView("history"); setMobileSidebarOpen(false); }}>
              <Banknote size={18} />
              <span>Old months</span>
              {cycles.filter((cycle) => cycle.status === "closed").length ? <b>{cycles.filter((cycle) => cycle.status === "closed").length}</b> : null}
            </button>
          </nav>
        ) : null}
        <MessSwitcher currentMemberId={member.id} currentMess={currentMess} memberships={memberships} onCreateMess={onCreateMess} onSwitchMess={onSwitchMess} readOnly={readOnlyMode} />
        <div className="profile">
          <img src={user.photoURL} alt="" />
          <div>
            <strong>{member.name}</strong>
            <span>{member.role}</span>
          </div>
          <button className="icon-button" title="Sign out" onClick={trackedSignOut}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main no-cycle-main">
        {readOnlyMode ? <OfflineBanner isOnline={isOnline} onRetry={onRetryConnection} serverDataReady={serverDataReady} /> : null}
        {isAdmin && sidebarView === "history" ? (
          <History cycles={cycles} selectedCycleId={selectedHistoryCycleId} onSelectCycle={setSelectedHistoryCycleId} />
        ) : (
          <section className="panel no-cycle-panel">
            <div className="no-cycle-hero">
              <div className="no-cycle-hero__copy">
                <span className="eyebrow">Month setup</span>
                <h2>No month is running</h2>
                <p>{isAdmin ? "Start a month when everyone is ready to track meals and money." : "You’ll see the month here once an admin starts it."}</p>
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
                <span>Add lunch and dinner for each day.</span>
              </article>
              <article>
                <Wallet size={18} />
                <strong>Deposits</strong>
                <span>Keep everyone’s advance money clear.</span>
              </article>
              <article>
                <Banknote size={18} />
                <strong>Old months</strong>
                <span>Check previous months after closing them.</span>
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
                  <DateInput label="Start date" value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate })} />
                </label>
                <label>
                  Meal rate type
                  <select value={form.rateMode} onChange={(event) => setForm({ ...form, rateMode: event.target.value })}>
                    <option value="static">Fixed meal rate</option>
                    <option value="calculated">Calculate from bazaar</option>
                  </select>
                </label>
                <label>
                  Default meal rate
                  <input min="1" type="number" value={form.mealRate} onChange={(event) => setForm({ ...form, mealRate: event.target.value })} />
                </label>
                <div className="cycle-member-picker">
                  <div>
                    <strong>People for this month</strong>
                    <span>Only these people will count in meals, deposits, and balances.</span>
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
                  <Plus size={18} /> Start month
                </button>
              </form>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}

function Dashboard({ activeMembers, currentCycle, expenses, isAdmin, isCalculatedMonth, ledger, mealEntries, member, members, pendingCount, setActiveView, setCurrentCycle, setMobileSidebarOpen, setSelectedHistoryCycleId, setMessage, totals, deposits, messCash, settings, setDepositDefaultAction, setDepositScrollRequest }) {
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

      <section className="toolbar-band">
        <button className="primary" onClick={() => setActiveView("meals")}>
          <Plus size={18} /> Add meal
        </button>
        {isCalculatedMonth ? (
          <button className="secondary" onClick={() => setActiveView("expenses")}>
          <Plus size={18} /> Add bazaar
          </button>
        ) : null}
        <button className="secondary" onClick={() => {
          setDepositDefaultAction("deposit");
          setActiveView("deposits");
        }}>
          <Plus size={18} /> Add deposit
        </button>
        <button className="secondary" onClick={() => {
          setDepositDefaultAction("merchant");
          setDepositScrollRequest(Date.now());
          setActiveView("deposits");
        }}>
          <Plus size={18} /> Paid to merchant
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
          <span className="eyebrow">Everyone’s balance</span>
          <h2>Member summary</h2>
          <p>Meals, deposits, costs, and balance for each person.</p>
        </div>
        <div className="summary-note">
          <span>{rows.length} people</span>
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
            <CalendarDayButton cell={cell} isSelected={cell.date === selectedDate} onClick={() => openDateDetails(cell.date)} />
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

function CalendarDayButton({ cell, isSelected, onClick }) {
  const orderedMeals = taka(cell.entries.reduce((sum, entry) => sum + Number(entry.boxCount || 0), 0));
  return (
    <button className={isSelected ? "calendar-day selected" : "calendar-day"} onClick={onClick}>
      <span>{cell.day}</span>
      {orderedMeals ? <small>{orderedMeals} meal{orderedMeals === 1 ? "" : "s"}</small> : null}
    </button>
  );
}

function Meals({ activeMembers, currentCycle, dailyMeals, expenses, isAdmin, mealEntries, member, settings, setMessage }) {
  const [date, setDate] = useState(today());
  const [lunchRate, setLunchRate] = useState(settings.mealRate || 70);
  const [lunchOrdered, setLunchOrdered] = useState(0);
  const [lunchPortions, setLunchPortions] = useState({});
  const [lunchUnavailable, setLunchUnavailable] = useState({});
  const [lunchSkipped, setLunchSkipped] = useState(false);
  const [dinnerRate, setDinnerRate] = useState(settings.mealRate || 70);
  const [dinnerOrdered, setDinnerOrdered] = useState(0);
  const [dinnerPortions, setDinnerPortions] = useState({});
  const [dinnerUnavailable, setDinnerUnavailable] = useState({});
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
      setLunchUnavailable({});
      setLunchSkipped(Boolean(existingDailyMeal.lunch?.skipped));
      setDinnerOrdered(getSessionBoxCount(existingDailyMeal.dinner));
      setDinnerRate(existingDailyMeal.dinner?.rate || defaultRate);
      setDinnerPortions(hydratePortions(existingDailyMeal.dinner?.portions));
      setDinnerUnavailable({});
      setDinnerSkipped(Boolean(existingDailyMeal.dinner?.skipped));
    } else {
      setLunchOrdered(0);
      setLunchRate(defaultRate);
      setLunchPortions(blankPortions());
      setLunchUnavailable({});
      setLunchSkipped(false);
      setDinnerOrdered(0);
      setDinnerRate(defaultRate);
      setDinnerPortions(blankPortions());
      setDinnerUnavailable({});
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
  const selectedDayLabel = date === today() ? "today" : "this date";
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

  function setAllPortions(setter, value, targetMembers = editableMembers) {
    const next = {};
    editableMembers.forEach((person) => {
      next[person.id] = 0;
    });
    targetMembers.forEach((person) => {
      next[person.id] = value;
    });
    setter(next);
  }

  function setEvenSplit(setter, total, targetMembers = editableMembers) {
    const count = targetMembers.length;
    if (!count) {
      setter({});
      return;
    }

    const baseShare = count > 0 ? taka(Number(total || 0) / count) : 0;
    const next = {};
    editableMembers.forEach((person) => {
      next[person.id] = 0;
    });
    targetMembers.forEach((person, index) => {
      next[person.id] = index === count - 1 ? taka(Number(total || 0) - baseShare * (count - 1)) : baseShare;
    });
    setter(next);
  }

  function toggleUnavailable(setUnavailable, setPortions, memberId, session) {
    setUnavailable((current) => {
      const next = { ...current, [memberId]: !current[memberId] };
      if (next[memberId]) {
        setPortions((portionsNow) => ({ ...portionsNow, [memberId]: 0 }));
      }
      trackEvent(next[memberId] ? "meal_member_temporarily_removed" : "meal_member_restored", { session });
      return next;
    });
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
    setLunchUnavailable({});
    setLunchSkipped(Boolean(existingDailyMeal.lunch?.skipped));
    setDinnerOrdered(getSessionBoxCount(existingDailyMeal.dinner));
    setDinnerRate(existingDailyMeal.dinner?.rate || defaultRate);
    setDinnerPortions(hydratePortions(existingDailyMeal.dinner?.portions));
    setDinnerUnavailable({});
    setDinnerSkipped(Boolean(existingDailyMeal.dinner?.skipped));
    setEditingRates({ lunch: false, dinner: false });
    setIsEditingDay(false);
  }

  async function approveDailyMeal() {
    if (!existingDailyMeal) return;
    await updateRecord("dailyMeals", existingDailyMeal.id, { status: "approved" });
    setMessage(`Daily meal sheet approved for ${formatDisplayDate(date)}.`);
    trackEvent("meal_approved", {
      had_lunch: Boolean(existingDailyMeal.lunch?.eaters?.length),
      had_dinner: Boolean(existingDailyMeal.dinner?.eaters?.length),
    });
  }

  async function submitDailySheet(event) {
    event.preventDefault();
    setMealFormError("");

    if (isDateBeforeCycle) {
      setIsEditingDay(true);
      setMealFormError(`This date is before the month started on ${formatDisplayDate(cycleStartDate)}.`);
      trackFormError("daily_meal_sheet", "date_before_cycle");
      return;
    }

    const lunchDemandTotal = sumPortions(lunchPortions);
    const dinnerDemandTotal = sumPortions(dinnerPortions);
    const lunchEaters = lunchSkipped ? [] : Object.entries(lunchPortions).filter(([, val]) => Number(val) > 0);
    const dinnerEaters = dinnerSkipped ? [] : Object.entries(dinnerPortions).filter(([, val]) => Number(val) > 0);

    if (!lunchSkipped && !lunchEaters.length && !dinnerSkipped && !dinnerEaters.length) {
      setIsEditingDay(true);
      setMealFormError("Add lunch or dinner for at least one person.");
      trackFormError("daily_meal_sheet", "no_eaters");
      return;
    }

    if (isAdmin) {
      if ((!lunchSkipped && lunchEaters.length && Number(lunchOrdered) <= 0) || (!dinnerSkipped && dinnerEaters.length && Number(dinnerOrdered) <= 0)) {
        setIsEditingDay(true);
        setMealFormError("Add an ordered meal count, or mark that meal as skipped.");
        trackFormError("daily_meal_sheet", "missing_ordered_count");
        return;
      }

      if ((!lunchSkipped && lunchEaters.length && Math.abs(Number(lunchOrdered) - lunchDemandTotal) > 0.01) || (!dinnerSkipped && dinnerEaters.length && Math.abs(Number(dinnerOrdered) - dinnerDemandTotal) > 0.01)) {
        setIsEditingDay(true);
        setMealFormError("Ordered meals should match everyone’s portions before saving.");
        trackFormError("daily_meal_sheet", "ordered_count_mismatch");
        return;
      }
    }

    const docId = `${currentCycle.messId}_${currentCycle.id}_${date}`;
    const payload = {
      messId: currentCycle.messId,
      cycleId: currentCycle.id,
      date,
      rateMode: getMealRateMode(settings),
      lunch: buildSession(lunchDemandTotal, lunchRate, lunchPortions, lunchSkipped),
      dinner: buildSession(dinnerDemandTotal, dinnerRate, dinnerPortions, dinnerSkipped),
      status: isAdmin ? "approved" : "pending",
      createdBy: existingDailyMeal?.createdBy || member.id,
      createdByName: existingDailyMeal?.createdByName || member.name,
      submittedBy: member.id,
      submittedByName: member.name,
      submittedAt: serverTimestamp(),
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
          ? `Daily meal sheet ${existingDailyMeal ? "updated" : "saved"} for ${formatDisplayDate(date)}.`
          : "Meal saved. An admin will review it."
      );
      trackEvent(existingDailyMeal ? "meal_sheet_updated" : "meal_sheet_created", {
        status: payload.status,
        meal_rate_mode: payload.rateMode,
        lunch_skipped: lunchSkipped,
        dinner_skipped: dinnerSkipped,
        lunch_eaters: lunchEaters.length,
        dinner_eaters: dinnerEaters.length,
        lunch_meals: lunchDemandTotal,
        dinner_meals: dinnerDemandTotal,
      });
    } catch (error) {
      console.error("Daily meal save failed", error);
      setMessage(error.code === "permission-denied" ? "Couldn’t save this meal. Please refresh and try again." : error.message);
      trackEvent("meal_sheet_save_failed", { error_code: error.code || "unknown" });
    } finally {
      setIsSaving(false);
    }
  }

  if (!existingDailyMeal && !isEditingDay) {
    return (
      <section className="panel meal-empty-panel">
        <div className="section-heading">
          <h2>Daily meal sheet</h2>
          <p>Pick a date and add lunch or dinner for everyone.</p>
        </div>
        <div className="meal-sheet-top compact">
          <label>
            Date
            <DateInput label="Meal date" min={cycleStartDate} showToday value={date} onChange={setDate} />
          </label>
        </div>
        {isDateBeforeCycle ? <p className="empty">This date is before this month started on {formatDisplayDate(cycleStartDate)}.</p> : null}
        <div className="date-empty-state">
          <Soup size={28} />
          <div>
            <strong>No meal added for {selectedDayLabel}</strong>
            <p>Lunch and dinner are empty for this date.</p>
          </div>
          <button className="primary" disabled={isDateBeforeCycle} type="button" onClick={() => {
            setIsEditingDay(true);
            trackEvent("meal_sheet_add_clicked", { selected_day: selectedDayLabel });
          }}>
            <Plus size={18} /> Add meal
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
              <h2>Daily meal sheet</h2>
              <p>
                {existingDailyMeal
                  ? `Showing ${formatDisplayDate(date)}. ${canEditSheet ? "Update lunch, dinner, and portions." : "Tap edit if you need to change it."}`
                  : "Add lunch and dinner, then set each person’s portion."}
              </p>
            </div>
            {existingDailyMeal ? (
              <div className="meal-heading-meta">
                <span className={existingDailyMeal.status === "approved" ? "status-badge approved" : "status-badge pending"}>{existingDailyMeal.status}</span>
                <span className="submitted-by-chip">Submitted by {existingDailyMeal.submittedByName || existingDailyMeal.createdByName || "Admin"}</span>
              </div>
            ) : null}
          </div>
        </div>
        <form onSubmit={submitDailySheet} className="form-grid">
          <div className="meal-sheet-top compact">
            <label>
              Date
              <DateInput label="Meal date" min={cycleStartDate} showToday value={date} onChange={setDate} />
            </label>
          </div>
          {isDateBeforeCycle ? <p className="empty">This date is before this month started on {formatDisplayDate(cycleStartDate)}.</p> : null}

          <div className="meal-day-summary">
            <article>
              <span>Lunch</span>
              <strong>{formatTk(lunchTotal)}</strong>
              <small>{lunchSkipped ? "No lunch" : `${taka(lunchDemandTotal)} ordered · ${lunchPeople} people`}</small>
            </article>
            <article>
              <span>Dinner</span>
              <strong>{formatTk(dinnerTotal)}</strong>
              <small>{dinnerSkipped ? "No dinner" : `${taka(dinnerDemandTotal)} ordered · ${dinnerPeople} people`}</small>
            </article>
            <article>
              <span>Day total</span>
              <strong>{formatTk(lunchTotal + dinnerTotal)}</strong>
              <small>{taka((lunchSkipped ? 0 : lunchDemandTotal) + (dinnerSkipped ? 0 : dinnerDemandTotal))} meals ordered</small>
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
              unavailableMembers={lunchUnavailable}
              setOrdered={setLunchOrdered}
              setPortions={setLunchPortions}
              setRate={setLunchRate}
              setEditingRate={(value) => setEditingRates((current) => ({ ...current, lunch: value }))}
              setSkipped={setLunchSkipped}
              updatePortion={updatePortion}
              adjustPortion={adjustPortion}
              setAllPortions={setAllPortions}
              setEvenSplit={setEvenSplit}
              toggleUnavailable={(memberId) => toggleUnavailable(setLunchUnavailable, setLunchPortions, memberId, "lunch")}
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
              unavailableMembers={dinnerUnavailable}
              setOrdered={setDinnerOrdered}
              setPortions={setDinnerPortions}
              setRate={setDinnerRate}
              setEditingRate={(value) => setEditingRates((current) => ({ ...current, dinner: value }))}
              setSkipped={setDinnerSkipped}
              updatePortion={updatePortion}
              adjustPortion={adjustPortion}
              setAllPortions={setAllPortions}
              setEvenSplit={setEvenSplit}
              toggleUnavailable={(memberId) => toggleUnavailable(setDinnerUnavailable, setDinnerPortions, memberId, "dinner")}
            />
          </div>
          {mealFormError ? <div className="meal-form-error">{mealFormError}</div> : null}
          <div className="form-actions">
            {isAdmin && existingDailyMeal?.status === "pending" && !canEditSheet ? (
              <button className="primary" type="button" onClick={approveDailyMeal}>
                <Check size={18} /> Approve
              </button>
            ) : null}
            {existingDailyMeal && !canEditSheet && canEditExisting ? (
              <button className="secondary" type="button" onClick={() => {
                setIsEditingDay(true);
                trackEvent("meal_sheet_edit_clicked", { status: existingDailyMeal.status });
              }}>
                <Pencil size={18} /> Edit
              </button>
            ) : null}
            {canEditSheet ? (
              <>
                {existingDailyMeal ? <button className="secondary" type="button" onClick={cancelEditing}>Cancel</button> : null}
                <button className="primary" disabled={isSaving || isDateBeforeCycle} type="submit">
                  <Check size={18} /> {isSaving ? "Saving..." : existingDailyMeal ? "Update meal" : "Save meal"}
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
  toggleUnavailable,
  unavailableMembers = {},
  updatePortion,
}) {
  const portionControlsDisabled = disabled || skipped;
  const availableMembers = activeMembers.filter((person) => !unavailableMembers[person.id]);
  const sessionCount = skipped ? 0 : Number(ordered) || 0;
  const rateDisabled = disabled || skipped || !allowRateEdit;
  const totalPortions = skipped ? 0 : taka(Object.values(portions).reduce((sum, value) => sum + Number(value || 0), 0));
  const estimatedTotal = skipped ? 0 : taka(sessionCount * (Number(rate) || 0));
  const activeCount = skipped ? 0 : Object.values(portions).filter((value) => Number(value) > 0).length;
  const sessionClass = label.toLowerCase();
  const sessionName = sessionClass;

  function chooseOrderedMealCount(count, source = "chip") {
    setOrdered(count);
    trackEvent("ordered_meal_count_selected", { session: sessionName, source, count: Number(count || 0) });
  }

  function applyPortionPreset(action, callback) {
    callback();
    trackEvent("meal_portion_preset_used", {
      session: sessionName,
      action,
      available_member_count: availableMembers.length,
      ordered_meals: Number(ordered || 0),
    });
  }

  return (
    <section className={`meal-session-box meal-session-box--${sessionClass}${disabled ? " readonly" : skipped ? " skipped" : ""}`}>
      <div className="meal-session-header">
        <div>
          <h3>{label}</h3>
          <span>{skipped ? `No ${label.toLowerCase()}` : `${formatTk(estimatedTotal)} total · ${activeCount} eating`}</span>
        </div>
        {allowCountEdit ? (
          <>
            <div className="session-controls">
              <label className="ordered-field">
                Ordered meals
                <input disabled={portionControlsDisabled} min="0" step="0.5" type="number" value={ordered} onChange={(event) => setOrdered(event.target.value)} />
              </label>
              <div className="ordered-meal-pills" aria-label={`${label} ordered meals quick choices`}>
                {[1, 2, 3, 4].map((count) => (
                  <button
                    className={Number(ordered) === count ? "active" : ""}
                    disabled={portionControlsDisabled}
                    key={count}
                    type="button"
                    onClick={() => chooseOrderedMealCount(count)}
                  >
                    {count}
                  </button>
                ))}
                <button
                  disabled={portionControlsDisabled}
                  type="button"
                  onClick={() => chooseOrderedMealCount(taka((Number(ordered) || 0) + 1), "more")}
                >
                  More
                </button>
              </div>
              <label className="rate-field">
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
                          trackEvent("meal_rate_confirmed", { session: sessionName, source: "enter" });
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
                        trackEvent("meal_rate_confirmed", { session: sessionName, source: "button" });
                      }}
                    >
                      <Check size={13} />
                    </button>
                  ) : (
                    <button disabled={rateDisabled} type="button" title="Edit rate" onClick={() => {
                      setEditingRate(true);
                      trackEvent("meal_rate_edit_started", { session: sessionName });
                    }}>
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
                      trackEvent("meal_rate_reset", { session: sessionName });
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              </label>
            </div>
          </>
        ) : null}
      </div>

      {allowCountEdit ? (
        <div className="meal-quick-actions">
          <button disabled={portionControlsDisabled || !availableMembers.length} type="button" onClick={() => applyPortionPreset("all_1", () => setAllPortions(setPortions, 1, availableMembers))}>All 1</button>
          <button disabled={portionControlsDisabled || !availableMembers.length} type="button" onClick={() => applyPortionPreset("split_evenly", () => setEvenSplit(setPortions, ordered, availableMembers))}>Split evenly</button>
          <button disabled={portionControlsDisabled} type="button" onClick={() => applyPortionPreset("clear", () => setAllPortions(setPortions, 0, availableMembers))}>Clear</button>
        </div>
      ) : null}

      <div className="meal-member-list">
        {activeMembers.map((person) => (
          <div className={unavailableMembers[person.id] ? "meal-member-row unavailable" : "meal-member-row"} key={person.id}>
            <div className="meal-member-row__top">
              <span>{person.name}</span>
              <button
                className={unavailableMembers[person.id] ? "availability-toggle restore" : "availability-toggle"}
                disabled={disabled || skipped}
                aria-label={unavailableMembers[person.id] ? `Bring ${person.name} back for ${label}` : `Remove ${person.name} from ${label}`}
                title={unavailableMembers[person.id] ? "Bring back for this meal" : "Remove for this meal"}
                type="button"
                onClick={() => toggleUnavailable?.(person.id)}
              >
                {unavailableMembers[person.id] ? <Plus size={14} /> : <X size={14} />}
              </button>
              
            </div>
            <div className="portion-controls">
              <button disabled={portionControlsDisabled || unavailableMembers[person.id]} type="button" onClick={() => adjustPortion(setPortions, person.id, -0.5)}>-</button>
              <input
                disabled={portionControlsDisabled || unavailableMembers[person.id]}
                min="0"
                step="any"
                type="number"
                value={portions[person.id] ?? 0}
                onChange={(event) => updatePortion(setPortions, person.id, event.target.value)}
              />
              <button disabled={portionControlsDisabled || unavailableMembers[person.id]} type="button" onClick={() => adjustPortion(setPortions, person.id, 0.5)}>+</button>
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
    if (Number(form.amount) <= 0) {
      trackFormError("expense", "missing_amount");
      return setMessage("Add the amount first.");
    }
    await addRecord("expenses", {
      messId: currentCycle.messId,
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
    setMessage(isAdmin ? "Expense added." : "Expense saved. An admin will review it.");
    trackEvent("expense_created", {
      status: isAdmin ? "approved" : "pending",
      category: form.category,
      amount: Number(form.amount),
    });
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-heading">
          <h2>Add bazaar or expense</h2>
          <p>Use this for spending from the shared mess cash.</p>
        </div>
        <form className="form-grid" onSubmit={submitExpense}>
          <label>
            Date
            <DateInput value={form.date} onChange={(date) => setForm({ ...form, date })} />
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
            Paid from mess cash
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
  const title = type === "mealEntries" ? "Meals" : "Expenses";
  const pendingEntries = entries.filter((entry) => entry.status === "pending");
  const approvedEntries = entries.filter((entry) => entry.status !== "pending");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  async function approve(entry) {
    await updateRecord(type, entry.id, { status: "approved" });
    trackEvent(`${type === "mealEntries" ? "meal_entry" : "expense"}_approved`, { status: entry.status });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await deleteRecord(type, deleteTarget.id);
    trackEvent(`${type === "mealEntries" ? "meal_entry" : "expense"}_deleted`, { status: deleteTarget.status });
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
                <strong>{formatDisplayDate(entry.date)}</strong>
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
            {formatDisplayDate(entry.date)} · {entry.status} · added by {entry.createdByName || "admin"}
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
              ? `${pendingEntries.length} item${pendingEntries.length === 1 ? "" : "s"} waiting.`
              : "Nothing waiting right now."
            : "Your saved items show here while an admin checks them."}
        </p>
      </div>
      <div className="entry-list">
        {pendingEntries.length ? <div className="entry-group-label">Waiting</div> : null}
        {pendingEntries.map(renderEntry)}
        {pendingEntries.length && approvedEntries.length ? <div className="entry-group-label">Saved</div> : null}
        {approvedEntries.map(renderEntry)}
        {!entries.length ? <p className="empty">Nothing here yet.</p> : null}
      </div>
      <EntryEditModal
        entry={editTarget}
        members={members}
        onCancel={() => setEditTarget(null)}
        onSave={async (payload) => {
          await updateRecord(type, editTarget.id, payload);
          trackEvent(`${type === "mealEntries" ? "meal_entry" : "expense"}_edited`);
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
        title={`Delete this ${type === "mealEntries" ? "meal" : "expense"}?`}
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
          <h2>{isMeal ? "Edit meal" : "Edit expense"}</h2>
          <p>Change anything that needs fixing.</p>
        </div>
        <div className="form-grid">
          <label>
            Date
            <DateInput value={draft.date || ""} onChange={(date) => setDraft({ ...draft, date })} />
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
            <span className="eyebrow">Just checking</span>
            <h2 id="confirm-title">{title}</h2>
            <p>{message}</p>
          </div>
        </div>
        <div className="confirm-modal__footer">
          <div className="confirm-modal__note">
            <Trash2 size={16} />
            <span>Please confirm so this doesn’t happen by accident.</span>
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

function Deposits({ activeMembers, currentCycle, defaultAction = "deposit", deposits, expenses, isAdmin, member, merchantScrollRequest = 0, onMerchantScrollConsumed, setMessage }) {
  const merchantSectionRef = useRef(null);
  const [form, setForm] = useState({ date: today(), memberId: member.id, amount: "", note: "Advance deposit" });
  const [merchantForm, setMerchantForm] = useState({ date: today(), amount: "" });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteMerchantTarget, setDeleteMerchantTarget] = useState(null);
  const visibleDeposits = isAdmin ? deposits : deposits.filter((deposit) => deposit.memberId === member.id || deposit.status === "approved");
  const merchantPayments = expenses.filter((expense) => expense.category === "meal" && expense.payerId === "mess_cash");
  const visibleMerchantPayments = isAdmin ? merchantPayments : merchantPayments.filter((expense) => expense.createdBy === member.id || expense.status === "approved");
  const showMerchantFirst = defaultAction === "merchant";

  useEffect(() => {
    if (!merchantScrollRequest) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      merchantSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      onMerchantScrollConsumed?.();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [merchantScrollRequest, onMerchantScrollConsumed]);

  async function submitDeposit(event) {
    event.preventDefault();
    if (!form.memberId || Number(form.amount) <= 0) {
      trackFormError("deposit", !form.memberId ? "missing_member" : "missing_amount");
      return setMessage("Choose a person and add the deposit amount.");
    }
    await addRecord("deposits", {
      messId: currentCycle.messId,
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
    setMessage(isAdmin ? "Deposit added." : "Deposit saved. An admin will review it.");
    trackEvent("deposit_created", {
      status: isAdmin ? "approved" : "pending",
      amount: Number(form.amount),
      own_deposit: form.memberId === member.id,
    });
  }

  async function submitMerchantPayment(event) {
    event.preventDefault();
    if (Number(merchantForm.amount) <= 0) {
      trackFormError("merchant_payment", "missing_amount");
      return setMessage("Add the paid amount first.");
    }

    await addRecord("expenses", {
      messId: currentCycle.messId,
      cycleId: currentCycle.id,
      date: merchantForm.date,
      title: "Paid to merchant",
      category: "meal",
      amount: Number(merchantForm.amount),
      payerId: "mess_cash",
      splitMethod: "mess_fund",
      participants: [],
      customShares: {},
      status: isAdmin ? "approved" : "pending",
      createdBy: member.id,
      createdByName: member.name,
    });
    setMerchantForm({ ...merchantForm, amount: "" });
    setMessage(isAdmin ? "Merchant payment added." : "Merchant payment saved. An admin will review it.");
    trackEvent("merchant_payment_created", {
      status: isAdmin ? "approved" : "pending",
      amount: Number(merchantForm.amount),
    });
  }

  return (
    <div className="two-column">
      <div className="stack">
        <section className={showMerchantFirst ? "panel deposit-form-panel muted" : "panel deposit-form-panel"}>
          <div className="section-heading">
            <h2>Add deposit</h2>
            <p>Use this when someone gives money to the mess.</p>
          </div>
          <form className="form-grid" onSubmit={submitDeposit}>
            <label>
              Date
              <DateInput value={form.date} onChange={(date) => setForm({ ...form, date })} />
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

        <section ref={merchantSectionRef} className={showMerchantFirst ? "panel merchant-payment-panel" : "panel merchant-payment-panel muted"}>
          <div className="section-heading">
            <h2>Paid to merchant</h2>
            <p>Use this when mess cash is paid for meals. It reduces cash and counts as meal cost.</p>
          </div>
          <form className="form-grid" onSubmit={submitMerchantPayment}>
            <label>
              Date
              <DateInput value={merchantForm.date} onChange={(date) => setMerchantForm({ ...merchantForm, date })} />
            </label>
            <label>
              Amount
              <input min="1" type="number" value={merchantForm.amount} onChange={(event) => setMerchantForm({ ...merchantForm, amount: event.target.value })} />
            </label>
            <div className="fund-note">
              Paid from mess cash
            </div>
            <button className="primary" type="submit">
              <Plus size={18} /> Save merchant payment
            </button>
          </form>
        </section>
      </div>

      <div className="stack">
        <section className="panel deposit-list-panel">
          <div className="section-heading">
            <h2>Deposits</h2>
            <p>Money added by everyone this month.</p>
          </div>
          <div className="entry-list">
            {visibleDeposits.map((deposit) => (
              <article className="entry-row" key={deposit.id}>
                <div>
                  <strong>
                    {activeMembers.find((person) => person.id === deposit.memberId)?.name || deposit.memberId} paid {formatTk(deposit.amount)} on {formatDisplayDate(deposit.date)}
                  </strong>
                  <span>
                    {deposit.status}
                  </span>
                  <small>{deposit.note || "Deposit"}</small>
                </div>
                {isAdmin ? (
                  <div className="row-actions">
                    {deposit.status === "pending" ? (
                      <button className="icon-button approve" title="Approve" onClick={async () => {
                        await updateRecord("deposits", deposit.id, { status: "approved" });
                        trackEvent("deposit_approved", { amount: Number(deposit.amount || 0) });
                      }}>
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

        <section className="panel merchant-list-panel">
          <div className="section-heading">
            <h2>Merchant payments</h2>
            <p>Meal payments made from mess cash.</p>
          </div>
          <div className="entry-list">
            {visibleMerchantPayments.map((payment) => (
              <article className="entry-row" key={payment.id}>
                <div>
                  <strong>{formatTk(payment.amount)}</strong>
                  <span>
                    {formatDisplayDate(payment.date)} · {payment.status}
                  </span>
                  <small>Paid to merchant from mess cash</small>
                </div>
                {isAdmin ? (
                  <div className="row-actions">
                    {payment.status === "pending" ? (
                      <button className="icon-button approve" title="Approve" onClick={async () => {
                        await updateRecord("expenses", payment.id, { status: "approved" });
                        trackEvent("merchant_payment_approved", { amount: Number(payment.amount || 0) });
                      }}>
                        <Check size={17} />
                      </button>
                    ) : null}
                    <button className="icon-button danger-icon" title="Delete" onClick={() => setDeleteMerchantTarget(payment)}>
                      <Trash2 size={17} />
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {!visibleMerchantPayments.length ? <p className="empty">No merchant payments yet.</p> : null}
          </div>
        </section>
      </div>

      <ConfirmModal
        confirmLabel="Delete"
        message="This deposit entry will be permanently removed."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          await deleteRecord("deposits", deleteTarget.id);
          trackEvent("deposit_deleted", { status: deleteTarget.status, amount: Number(deleteTarget.amount || 0) });
          setDeleteTarget(null);
        }}
        open={Boolean(deleteTarget)}
        title="Delete this deposit?"
      />
      <ConfirmModal
        confirmLabel="Delete"
        message="This merchant payment will be permanently removed."
        onCancel={() => setDeleteMerchantTarget(null)}
        onConfirm={async () => {
          await deleteRecord("expenses", deleteMerchantTarget.id);
          trackEvent("merchant_payment_deleted", { status: deleteMerchantTarget.status, amount: Number(deleteMerchantTarget.amount || 0) });
          setDeleteMerchantTarget(null);
        }}
        open={Boolean(deleteMerchantTarget)}
        title="Delete this merchant payment?"
      />
    </div>
  );
}

function Members({ currentCycle, currentMess, cycleMembers, member, members, setCurrentCycle, setMessage }) {
  const [form, setForm] = useState({ role: "member" });
  const [inviteLink, setInviteLink] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [cycleMemberToAdd, setCycleMemberToAdd] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const householdActiveMembers = members.filter((item) => item.active);
  const includedIds = currentCycle?.memberIds || [];
  const availableForCycle = householdActiveMembers.filter((person) => !includedIds.includes(person.id));
  const activeAdminCount = members.filter((person) => person.active && person.role === "admin").length;

  async function submitMember(event) {
    event.preventDefault();
    try {
      setCreatingInvite(true);
      setInviteCopied(false);
      const activeMessId = currentMess?.id || member.messId || currentCycle?.messId;
      if (!activeMessId) throw new Error("No mess is selected. Refresh once and try again.");
      const token = await createInvite({ messId: activeMessId, messName: currentMess?.name || "", role: form.role, createdBy: member.id });
      const link = `${window.location.origin}${window.location.pathname}?invite=${token}`;
      setInviteLink(link);
      const copied = await copyToClipboard(link);
      setInviteCopied(copied);
      setMessage(copied ? "Invite link is ready and copied." : "Invite link is ready. Copy it below.");
      trackEvent("invite_created", { role: form.role, copied });
    } catch (error) {
      console.error("Invite creation failed", error);
      setMessage(error.code === "permission-denied" ? "Couldn’t make the invite link. Please refresh and try again." : error.message);
      trackEvent("invite_create_failed", { error_code: error.code || "unknown", role: form.role });
    } finally {
      setCreatingInvite(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    const copied = await copyToClipboard(inviteLink);
    setInviteCopied(copied);
    setMessage(copied ? "Invite link copied." : "Couldn’t auto-copy. Select the link and copy it manually.");
    trackEvent("invite_copied", { copied });
  }

  async function addMemberToCycle(memberId) {
    const nextMemberIds = [...new Set([...includedIds, memberId])];
    await updateRecord("cycles", currentCycle.id, { memberIds: nextMemberIds });
    setCurrentCycle({ ...currentCycle, memberIds: nextMemberIds });
    setCycleMemberToAdd("");
    setMessage("Person added to this month.");
    trackEvent("cycle_member_added", { member_count: nextMemberIds.length });
  }

  async function deleteMemberFromWorkspace() {
    if (!deleteTarget) return;
    if (deleteTarget.role === "admin") {
      setDeleteTarget(null);
      trackFormError("delete_member", "admin_locked");
      return setMessage("Admins can’t be deleted. Change their role first.");
    }

    const nextMemberIds = includedIds.filter((id) => id !== deleteTarget.id);
    if (nextMemberIds.length !== includedIds.length) {
      await updateRecord("cycles", currentCycle.id, { memberIds: nextMemberIds });
      setCurrentCycle({ ...currentCycle, memberIds: nextMemberIds });
    }

    await deleteRecord("members", deleteTarget.id);
    setDeleteTarget(null);
    setMessage("Person removed from this mess.");
    trackEvent("member_deleted", { was_in_current_cycle: includedIds.includes(deleteTarget.id) });
  }

  async function changeMemberRole(person, role) {
    if (person.role === "admin" && role !== "admin" && activeAdminCount <= 1) {
      trackFormError("member_role", "last_admin");
      return setMessage("Keep at least one active admin.");
    }
    await updateRecord("members", person.id, { role });
    trackEvent("member_role_changed", { from_role: person.role, to_role: role });
  }

  async function toggleMemberActive(person) {
    if (person.active && person.role === "admin" && activeAdminCount <= 1) {
      trackFormError("member_active_toggle", "last_admin");
      return setMessage("Keep at least one active admin.");
    }
    await updateRecord("members", person.id, { active: !person.active });
    trackEvent(person.active ? "member_deactivated" : "member_activated", { role: person.role });
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-heading">
          <h2>Invite someone</h2>
          <p>Make a one-time link for the next housemate. Pick their role first.</p>
        </div>
        <form className="form-grid" onSubmit={submitMember}>
          <label>
            Role
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="primary" disabled={creatingInvite} type="submit">
            <Plus size={18} /> {creatingInvite ? "Creating..." : "Create invite link"}
          </button>
          {inviteLink ? (
            <div className="invite-result">
              <div>
                <strong>{inviteCopied ? "Copied. Send it now." : "Share this invite link."}</strong>
                <span>{form.role === "admin" ? "The next person will join as admin." : "The next person will join as member."}</span>
              </div>
              <div className="invite-link-row">
                <input aria-label="Invite link" readOnly value={inviteLink} onFocus={(event) => event.target.select()} />
                <button className="secondary" type="button" onClick={copyInviteLink}>
                  <Copy size={16} /> Copy
                </button>
              </div>
            </div>
          ) : null}
        </form>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>People in this mess</h2>
          <p>Manage roles, access, and who counts this month.</p>
        </div>
        <div className="cycle-member-manager">
          <div className="cycle-member-manager__header">
            <div>
              <span className="eyebrow">This month</span>
              <p>Only these people count in meals, deposits, and balances.</p>
            </div>
            <span className="cycle-member-count">{includedIds.length} picked</span>
          </div>
          <div className="cycle-member-pills">
            {cycleMembers.map((person) => (
              <span key={person.id}>{person.name}</span>
            ))}
          </div>
          {availableForCycle.length ? (
            <div className="cycle-member-add">
              <label>
                Add person
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
            <p className="cycle-member-complete">Everyone active is already in this month.</p>
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
                  title={person.role === "admin" ? "Admins can’t be deleted while they are admin" : "Delete person"}
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
        confirmLabel="Delete person"
        message={deleteTarget ? `${deleteTarget.name} will be removed from this mess and this month. Old saved records will stay as they are.` : ""}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteMemberFromWorkspace}
        open={Boolean(deleteTarget)}
        title="Delete this person?"
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
    setMessage("Name updated.");
    trackEvent("member_name_updated", { own_profile: false });
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
        <span className="eyebrow">Old months</span>
        <h2>Closed months</h2>
        <p>See the final meal count, deposits, costs, and balances from past months.</p>
      </div>
      {selectedCycle ? (
        <div className="history-item history-item--detail">
          <div className="history-item__header">
            <div>
              <strong>{selectedCycle.name || formatDisplayDateRange(selectedCycle.startDate, selectedCycle.endDate)}</strong>
              <span>{formatDisplayDateRange(selectedCycle.startDate, selectedCycle.endDate, "closed")}</span>
            </div>
            {closed.length > 1 ? (
              <select value={selectedCycle.id} onChange={(event) => onSelectCycle?.(event.target.value)}>
                {closed.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name || formatDisplayDateRange(cycle.startDate, cycle.endDate)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="history-kpis">
            <article>
              <span>Meals</span>
              <strong>{formatTk(selectedCycle.snapshot?.totals?.meals || 0)}</strong>
            </article>
            <article>
              <span>Deposits</span>
              <strong>{formatTk(selectedCycle.snapshot?.totals?.deposits || 0)}</strong>
            </article>
            <article>
              <span>Expenses</span>
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
                  <strong>{formatDisplayDate(day.date)}</strong>
                  <span>{day.meals.length} saved meal{day.meals.length === 1 ? "" : "s"}</span>
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
            )) : <p className="empty">No day-by-day records saved for this month.</p>}
          </div>
        </div>
      ) : null}
      <div className="history-grid">
        {closed.map((cycle) => (
          <article className={cycle.id === selectedCycle?.id ? "history-item active" : "history-item"} key={cycle.id} onClick={() => onSelectCycle?.(cycle.id)} role="button" tabIndex={0}>
            <div className="history-item__header">
              <div>
                <strong>{cycle.name || formatDisplayDateRange(cycle.startDate, cycle.endDate)}</strong>
                <span>{formatDisplayDateRange(cycle.startDate, cycle.endDate, "closed")}</span>
              </div>
              <span className="history-status">Closed</span>
            </div>

            <div className="history-kpis">
              <article>
                <span>Meals</span>
                <strong>{formatTk(cycle.snapshot?.totals?.meals || 0)}</strong>
              </article>
              <article>
                <span>Deposits</span>
                <strong>{formatTk(cycle.snapshot?.totals?.deposits || 0)}</strong>
              </article>
              <article>
                <span>Expenses</span>
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
                    <span>{row.balance >= 0 ? "Has balance" : "Needs to pay"}</span>
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
        {!closed.length ? <p className="empty">No old months yet.</p> : null}
      </div>
    </section>
  );
}
