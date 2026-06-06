import { getAnalytics, isSupported, logEvent, setUserId, setUserProperties } from "firebase/analytics";
import { app } from "./firebase";

const analyticsEnabled = import.meta.env.VITE_ENABLE_ANALYTICS !== "false";
const hasMeasurementId = Boolean(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID);
const isEmulator = import.meta.env.VITE_USE_FIRESTORE_EMULATOR === "true";

let analyticsPromise = null;
let anonymousUserId = null;
let lastPageViewKey = "";

function getAnonymousUserId() {
  if (anonymousUserId) return anonymousUserId;

  const key = "pakhir-basa:analytics-user-id";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) {
      anonymousUserId = existing;
      return anonymousUserId;
    }

    anonymousUserId = window.crypto?.randomUUID?.() || `anon-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(key, anonymousUserId);
    return anonymousUserId;
  } catch {
    anonymousUserId = `anon-${Math.random().toString(36).slice(2)}`;
    return anonymousUserId;
  }
}

function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => {
        if (typeof value === "boolean") return [key, value ? "yes" : "no"];
        if (typeof value === "number") return [key, Number.isFinite(value) ? value : 0];
        return [key, String(value).slice(0, 100)];
      }),
  );
}

async function getAnalyticsInstance() {
  if (!analyticsEnabled || !hasMeasurementId || isEmulator || !app || typeof window === "undefined") return null;
  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((supported) => (supported ? getAnalytics(app) : null))
      .catch((error) => {
        console.warn("Analytics unavailable", error);
        return null;
      });
  }
  return analyticsPromise;
}

export async function identifyAnalyticsUser(member, context = {}) {
  const analytics = await getAnalyticsInstance();
  if (!analytics) return;

  setUserId(analytics, getAnonymousUserId());
  setUserProperties(analytics, cleanParams({
    role: member?.role || "guest",
    has_mess: Boolean(member?.messId),
    mess_count: context.messCount || 0,
    has_open_cycle: Boolean(context.hasOpenCycle),
    meal_rate_mode: context.mealRateMode,
  }));
}

export async function trackEvent(name, params = {}) {
  const analytics = await getAnalyticsInstance();
  if (!analytics) return;
  logEvent(analytics, name, cleanParams(params));
}

export function trackPageView(name, params = {}) {
  const key = `${name}:${JSON.stringify(cleanParams(params))}`;
  if (key === lastPageViewKey) return;
  lastPageViewKey = key;
  const safeLocation = `${window.location.origin}${window.location.pathname}`;
  trackEvent("page_view", {
    page_title: name,
    page_location: safeLocation,
    app_view: name,
    ...params,
  });
}

export function trackFormError(formName, errorType, params = {}) {
  trackEvent("form_error", {
    form_name: formName,
    error_type: errorType,
    ...params,
  });
}
