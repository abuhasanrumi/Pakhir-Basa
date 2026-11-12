import { useEffect, useState } from "react";
import { trackEvent } from "../analytics";

export function useOnlineStatus() {
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
