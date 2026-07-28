"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  // First-time visitors arriving from the marketing page (/login?mode=signup) land on the
  // account-creation view; everyone else defaults to sign-in.
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(() => {
    if (typeof window !== "undefined") {
      const m = new URLSearchParams(window.location.search).get("mode");
      if (m === "signup" || m === "forgot") return m;
    }
    return "signin";
  });
  const [tab, setTab] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  async function handleForgotPassword() {
    setMsg(null);
    if (!email) {
      setMsg({ kind: "err", text: "Enter your email address." });
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) throw error;
      setMsg({ kind: "ok", text: "Password reset email sent. Check your inbox." });
    } catch (e: unknown) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail() {
    setMsg(null);
    if (!email || !password) {
      setMsg({ kind: "err", text: "Enter your email and password." });
      return;
    }
    if (password.length < 6) {
      setMsg({ kind: "err", text: "Password must be at least 6 characters." });
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      setMsg({ kind: "err", text: "Passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        // If email confirmation is OFF, a session exists immediately -> go to consent.
        if (data.session) {
          router.push("/consent");
          router.refresh();
        } else {
          setMsg({
            kind: "ok",
            text: "Account created. Check your email to confirm, then sign in.",
          });
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/consent");
        router.refresh();
      }
    } catch (e: unknown) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setMsg(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setBusy(false);
      setMsg({ kind: "err", text: error.message });
    }
    // On success the browser redirects to Google, so no further code runs here.
  }

  return (
    <div className="auth-center">
      <div className="auth-card" suppressHydrationWarning>
        <div className="brand">
          RELENTLESS<span className="dot"> AI</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          {mode === "signin" ? "Sign in to your coaching dashboard" : mode === "signup" ? "Create your coaching account" : "Reset your password"}
        </div>

        <div className="tabs">
          <div
            className={`tab ${tab === "email" ? "active" : ""}`}
            onClick={() => setTab("email")}
          >
            Email &amp; Password
          </div>
          <div
            className={`tab ${tab === "otp" ? "active" : ""}`}
            onClick={() => setTab("otp")}
          >
            Mobile + OTP <span className="soon">SOON</span>
          </div>
        </div>

        {tab === "email" ? (
          <div className="stack">
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
            {mode !== "forgot" && (
              <input
                type="password"
                placeholder={mode === "signup" ? "Enter your password" : "Password"}
                value={password}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            {mode === "signup" && (
              <input
                type="password"
                placeholder="Retype your password"
                value={confirmPassword}
                autoComplete="new-password"
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) handleEmail();
                }}
              />
            )}
            {mode === "forgot" ? (
              <button className="btn btn-primary btn-block" onClick={handleForgotPassword} disabled={busy}>
                {busy ? "Please wait…" : "Send reset email"}
              </button>
            ) : (
              <button className="btn btn-primary btn-block" onClick={handleEmail} disabled={busy}>
                {busy ? "Please wait…" : mode === "signup" ? "Create account & continue" : "Sign in"}
              </button>
            )}
            <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
              {mode === "signin" ? (
                <>
                  <a
                    style={{ color: "var(--amber)", cursor: "pointer" }}
                    onClick={() => { setMode("forgot"); setMsg(null); }}
                  >
                    Forgot password?
                  </a>
                  {"  ·  "}
                  New here?{" "}
                  <a
                    style={{ color: "var(--amber)", cursor: "pointer" }}
                    onClick={() => { setMode("signup"); setPassword(""); setConfirmPassword(""); setMsg(null); }}
                  >
                    Create an account
                  </a>
                </>
              ) : (
                <>
                  <a
                    style={{ color: "var(--amber)", cursor: "pointer" }}
                    onClick={() => { setMode("signin"); setPassword(""); setConfirmPassword(""); setMsg(null); }}
                  >
                    Back to sign in
                  </a>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="stack">
            <input type="tel" placeholder="+1 555 010 0000" />
            <button className="btn btn-ghost btn-block" disabled>
              Send code (coming later)
            </button>
          </div>
        )}

        {msg && (
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              padding: "9px 12px",
              borderRadius: 8,
              background: msg.kind === "err" ? "#fef2f2" : "#f0fdf4",
              color: msg.kind === "err" ? "#b91c1c" : "#15803d",
              border: `1px solid ${msg.kind === "err" ? "#fecaca" : "#bbf7d0"}`,
            }}
          >
            {msg.text}
          </div>
        )}

        <div className="divider">or</div>

        <button className="google" onClick={handleGoogle} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.1 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.8 6c1.8-5.4 6.9-9.7 13.6-9.7z" />
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-17z" />
            <path fill="#FBBC05" d="M10.4 28.8c-.5-1.4-.7-2.8-.7-4.3s.3-2.9.7-4.3l-7.8-6C.9 17.4 0 20.6 0 24s.9 6.6 2.6 9.5l7.8-4.7z" />
            <path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.4-4.6 2.2-7.9 2.2-6.7 0-12.4-4.5-14.4-10.6l-7.8 4.7C6.4 42.6 14.6 48 24 48z" />
          </svg>
          Continue with Google
        </button>

        <div className="hint">By continuing you agree to the Terms &amp; Privacy Policy.</div>
      </div>
    </div>
  );
}
