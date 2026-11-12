import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { UpdateToast } from "./components/UpdateToast.jsx";
import { trackEvent } from "./analytics";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <UpdateToast />
  </React.StrictMode>,
);

function currentShellUrls() {
  const urls = new Set(["/", "/site.webmanifest", "/apple-touch-icon.png", "/icon.svg", "/maskable-icon.svg", "/offline.html"]);
  performance.getEntriesByType("resource").forEach((entry) => {
    try {
      const url = new URL(entry.name);
      if (url.origin === window.location.origin && url.pathname.startsWith("/assets/")) {
        urls.add(url.pathname);
      }
    } catch {
      // Ignore non-URL performance entries.
    }
  });
  return [...urls];
}

function cacheCurrentShell() {
  if (!navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: "CACHE_APP_SHELL", urls: currentShellUrls() });
  trackEvent("app_shell_cache_requested", { asset_count: currentShellUrls().length });
}

if ("serviceWorker" in navigator) {
  // A controller at startup means an older version was already installed, so a later
  // controller change is a new deploy: tell the app to offer a reload.
  const hadController = Boolean(navigator.serviceWorker.controller);
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((registration) => {
        trackEvent("service_worker_registered", { scope: registration.scope });
        cacheCurrentShell();
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          cacheCurrentShell();
          if (hadController) window.dispatchEvent(new Event("pb-update-ready"));
        });
        // Installed apps can stay open for days; check for a new version when reopened.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") registration.update().catch(() => undefined);
        });
      })
      .catch((error) => {
        console.warn("Service worker registration failed", error);
        trackEvent("service_worker_registration_failed", { error_code: error.name || "unknown" });
      });
  });
}

window.addEventListener("beforeinstallprompt", () => {
  trackEvent("pwa_install_prompt_available");
});

window.addEventListener("appinstalled", () => {
  trackEvent("pwa_installed");
});
