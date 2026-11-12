import { onAuthStateChanged } from "firebase/auth";
import { Banknote, CalendarCheck, LayoutGrid, LogOut, Plus, Soup, Users, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { identifyAnalyticsUser, trackEvent, trackPageView } from "./analytics";
import { Avatar } from "./components/Avatar.jsx";
import { MessSwitcher } from "./components/MessSwitcher.jsx";
import { MoreSheet } from "./components/MoreSheet.jsx";
import { QuickAddSheet } from "./components/QuickAddSheet.jsx";
import { OfflineBanner, SetupError, Shell } from "./components/StatusScreens.jsx";
import { auth, createMess, getMemberships, getMess, getOpenCycle, hasFirebaseConfig, joinInvite } from "./firebase";
import { useCollection } from "./hooks/useCollection";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { trackedSignOut } from "./lib/actions";
import { readLocalCache, writeLocalCache } from "./lib/cache";
import { calculateLedger, getCalculatedMealRate, getMealEntryRate, getMealRateMode, taka } from "./lib/calculations";
import { enrichMembershipsWithMessNames, flattenDailyMeals } from "./lib/meals";
import { Dashboard } from "./screens/Dashboard.jsx";
import { Money } from "./screens/Money.jsx";
import { History } from "./screens/History.jsx";
import { LoginScreen } from "./screens/LoginScreen.jsx";
import { Meals } from "./screens/Meals.jsx";
import { Members } from "./screens/Members.jsx";
import { MessSetupScreen } from "./screens/MessSetupScreen.jsx";
import { NoCycleScreen } from "./screens/NoCycleScreen.jsx";

export function App() {
  const [user, setUser] = useState(null);
  const [member, setMember] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [currentMess, setCurrentMess] = useState(null);
  const [currentCycle, setCurrentCycle] = useState(null);
  const [selectedHistoryCycleId, setSelectedHistoryCycleId] = useState("");
  const [activeView, setActiveView] = useState("dashboard");
  const [quickAdd, setQuickAdd] = useState({ open: false, step: null });
  const [mealSessionRequest, setMealSessionRequest] = useState("");
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

  if (!hasFirebaseConfig) return <SetupError message="Firebase is not configured. Add the VITE_FIREBASE_* values to .env." />;
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
    { id: "money", label: "Money", icon: Wallet },
    { id: "members", label: "People", icon: Users, adminOnly: true },
    { id: "history", label: "Old Months", icon: Banknote },
  ].filter((item) => (!item.adminOnly || isAdmin) && (!item.calculatedOnly || isCalculatedMonth));

  const moreViewIds = ["members", "history"];
  const primaryTabs = navigation.filter((item) => !moreViewIds.includes(item.id));
  const moreItems = navigation.filter((item) => moreViewIds.includes(item.id));
  const activeLabel = navigation.find((item) => item.id === activeView)?.label || "Home";

  function goTo(viewId, options = {}) {
    if (viewId === "meals" && !options.keepSession) setMealSessionRequest("");
    if (viewId === "history") setSelectedHistoryCycleId("");
    setActiveView(viewId);
    setMobileSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }

  const dueToMerchant = Math.max(
    0,
    taka(
      Number(totals.meals || 0) -
        expenses
          .filter((expense) => expense.status === "approved" && expense.category === "meal" && expense.payerId === "mess_cash")
          .reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    ),
  );

  function openQuickAdd(step = null) {
    setMobileSidebarOpen(false);
    setQuickAdd({ open: true, step });
    trackEvent("quick_add_opened", { step: step || "menu", view: activeView });
  }

  function openMealSession(session) {
    setQuickAdd({ open: false, step: null });
    setMealSessionRequest(session);
    goTo("meals", { keepSession: true });
  }

  return (
    <div className="app app--tabs">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">PB</div>
          <div>
            <strong>{currentMess?.name || "Pakhir Basa"}</strong>
            <span>Meal Tracker</span>
          </div>
        </div>

        <button className="primary sidebar-add" type="button" onClick={() => openQuickAdd()}>
          <Plus size={18} /> Add
        </button>

        <nav className="nav" aria-label="Main">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-current={activeView === item.id ? "page" : undefined}
                className={activeView === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                onClick={() => goTo(item.id)}
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
          <Avatar name={member.name} photoURL={user.photoURL} />
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
              <span>{currentCycle?.name || "This month"}</span>
            </div>
          </div>
          <button className="topbar-avatar" type="button" aria-label="Open account and more" onClick={() => setMobileSidebarOpen(true)}>
            <Avatar name={member.name} photoURL={user.photoURL} />
          </button>
          <div className="topbar-page-title">
            <p>{currentCycle?.name || "This month"}</p>
            <h1>{activeLabel}</h1>
          </div>
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
            openMealSession={openMealSession}
            onAdd={openQuickAdd}
            onOpenView={goTo}
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
            initialSession={mealSessionRequest}
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
        {activeView === "money" ? (
          <Money
            activeMembers={activeMembers}
            currentCycle={currentCycle}
            deposits={deposits}
            expenses={expenses}
            isAdmin={isAdmin}
            isCalculatedMonth={isCalculatedMonth}
            member={member}
            messCash={messCash}
            onAdd={openQuickAdd}
            setMessage={setMessage}
            totals={totals}
          />
        ) : null}
        {activeView === "members" && isAdmin ? <Members currentCycle={currentCycle} currentMess={currentMess} ledger={ledger} member={member} members={members} setCurrentCycle={setCurrentCycle} setMessage={setMessage} /> : null}
        {activeView === "history" ? <History cycles={cycles} selectedCycleId={selectedHistoryCycleId} onSelectCycle={setSelectedHistoryCycleId} /> : null}
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {[...primaryTabs.slice(0, 2), { id: "__add" }, ...primaryTabs.slice(2)].map((item) => {
          if (item.id === "__add") {
            return (
              <button aria-label="Add meal, deposit or payment" className="bottom-nav__add" key="add" type="button" onClick={() => openQuickAdd()}>
                <Plus size={26} />
              </button>
            );
          }
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button aria-current={isActive ? "page" : undefined} className={isActive ? "bottom-nav__item active" : "bottom-nav__item"} key={item.id} type="button" onClick={() => goTo(item.id)}>
              <span className="bottom-nav__icon">
                <Icon size={21} />
                {item.id === "dashboard" && pendingCount > 0 ? <b>{pendingCount}</b> : null}
              </span>
              <span>{item.shortLabel || item.label}</span>
            </button>
          );
        })}
        <button
          aria-expanded={mobileSidebarOpen}
          className={moreViewIds.includes(activeView) || mobileSidebarOpen ? "bottom-nav__item active" : "bottom-nav__item"}
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
        >
          <span className="bottom-nav__icon"><LayoutGrid size={21} /></span>
          <span>More</span>
        </button>
      </nav>

      {quickAdd.open ? (
        <QuickAddSheet
          activeMembers={activeMembers}
          currentCycle={currentCycle}
          dueToMerchant={dueToMerchant}
          isAdmin={isAdmin}
          isCalculatedMonth={isCalculatedMonth}
          member={member}
          onClose={() => setQuickAdd({ open: false, step: null })}
          onOpenMeal={openMealSession}
          onStepChange={(step) => setQuickAdd({ open: true, step })}
          setMessage={setMessage}
          step={quickAdd.step}
        />
      ) : null}

      {mobileSidebarOpen ? (
        <MoreSheet
          activeView={activeView}
          currentMess={currentMess}
          items={moreItems}
          member={member}
          onClose={() => setMobileSidebarOpen(false)}
          onNavigate={goTo}
          user={user}
        >
          <MessSwitcher currentMemberId={member.id} currentMess={currentMess} memberships={memberships} onCreateMess={createAnotherMess} onSwitchMess={switchMess} readOnly={readOnlyMode} />
        </MoreSheet>
      ) : null}
    </div>
  );
}
