import { Soup } from "lucide-react";
import { trackEvent } from "../analytics";
import { signInWithGoogle } from "../firebase";

export function LoginScreen() {
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
