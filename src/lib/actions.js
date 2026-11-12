import { trackEvent } from "../analytics";
import { signOutUser } from "../firebase";

export async function copyToClipboard(text) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function trackedSignOut() {
  trackEvent("sign_out_clicked");
  await signOutUser();
}
