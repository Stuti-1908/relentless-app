"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  // Safety check: ensure they are actually authenticated before letting them reset
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        setMsg({ kind: "err", text: "You must be logged in through a reset link to change your password." });
        router.replace("/login");
      }
    });
  }, [router, supabase]);

  async function handleReset() {
    setMsg(null);
    if (!password || !confirmPassword) {
      setMsg({ kind: "err", text: "Please enter and confirm your new password." });
      return;
    }
    if (password.length < 6) {
      setMsg({ kind: "err", text: "Password must be at least 6 characters." });
      return;
    }
    if (password !== confirmPassword) {
      setMsg({ kind: "err", text: "Passwords do not match." });
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });
      if (error) throw error;
      setMsg({ kind: "ok", text: "Password updated successfully. Redirecting to dashboard..." });
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } catch (e: unknown) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-center">
      <div className="auth-card">
        <div className="brand">
          RELENTLESS<span className="dot"> AI</span>
        </div>
        <h2 style={{ fontSize: 20, margin: "14px 0 4px" }}>Set New Password</h2>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, marginBottom: 14 }}>
          Enter a strong new password for your account.
        </div>

        <div className="stack">
          <input
            type="password"
            placeholder="New password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            autoComplete="new-password"
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) handleReset();
            }}
          />
          <button className="btn btn-primary btn-block" onClick={handleReset} disabled={busy}>
            {busy ? "Updating password…" : "Update Password"}
          </button>
        </div>

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
      </div>
    </div>
  );
}
