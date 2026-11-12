import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

// Shown when a new version of the app has been deployed while this one was open.
export function UpdateToast() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onReady = () => setReady(true);
    window.addEventListener("pb-update-ready", onReady);
    return () => window.removeEventListener("pb-update-ready", onReady);
  }, []);

  if (!ready) return null;

  return (
    <div className="update-toast" role="status">
      <span>A new version is ready.</span>
      <button className="primary" type="button" onClick={() => window.location.reload()}>
        <RefreshCw size={16} /> Reload
      </button>
    </div>
  );
}
