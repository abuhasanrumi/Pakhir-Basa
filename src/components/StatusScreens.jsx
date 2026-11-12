import { RotateCcw, Shield, Soup } from "lucide-react";
import { trackedSignOut } from "../lib/actions";
import { OFFLINE_NOTICE } from "../lib/format";

export function SetupError({ message }) {
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

export function OfflineBanner({ isOnline, onRetry, serverDataReady }) {
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

export function Shell({ message }) {
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
