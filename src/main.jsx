import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
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
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(() => {
        cacheCurrentShell();
        navigator.serviceWorker.addEventListener("controllerchange", cacheCurrentShell);
      })
      .catch((error) => {
        console.warn("Service worker registration failed", error);
      });
  });
}
