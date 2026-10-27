"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NOTIFICATION_CATEGORIES, type NotificationKey, type NotificationPrefs } from "@/lib/notificationPrefs";

type Load = "loading" | "ready" | "not_provisioned" | "error";
type Billing = {
  plan: { name: string; amount: string; interval: string };
  state: "active" | "past_due" | "beta" | "cancelled" | "none";
  canManage: boolean;
};

const BILLING_STATUS: Record<Billing["state"], { label: string; note: string }> = {
  active: { label: "Active", note: "Your subscription is active. Update your card, download invoices or cancel any time from the billing portal." },
  past_due: { label: "Payment past due", note: "Your last payment didn't go through. Update your card in the billing portal to keep your coaching running." },
  beta: { label: "Beta access", note: "You're on free beta access — nothing is being charged." },
  cancelled: { label: "Cancelled", note: "Your subscription has ended. Subscribe again to restart your coaching." },
  none: { label: "Not subscribed", note: "Subscribe to start receiving your daily coaching." },
};

export default function SettingsPage() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>("loading");
  const [prefs, setPrefs] = useState<NotificationPrefs>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [billing, setBilling] = useState<Billing | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), 3500);
  }, []);

  useEffect(() => {
    fetch("/api/billing", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.ok && setBilling(d))
      .catch(() => {});
  }, []);

  async function openPortal() {
    setPortalBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      flash("err", "Billing portal isn't available right now — email support and we'll sort it out.");
    } catch {
      flash("err", "Couldn't open the billing portal — please try again.");
    }
    setPortalBusy(false);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/notification-prefs", { cache: "no-store" });
        if (res.status === 401) return router.replace("/login");
        const data = await res.json();
        if (data.ok) {
          setPrefs(data.prefs ?? {});
          setLoad("ready");
        } else {
          setLoad(data.reason === "not_provisioned" ? "not_provisioned" : "error");
        }
      } catch {
        setLoad("error");
      }
    })();
    return () => {
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, [router]);

  // Optimistic: flip immediately, save, and roll back (with a message) if the save fails.
  async function toggle(key: NotificationKey | "paused", value: boolean) {
    const before = prefs[key];
    setPrefs((p) => ({ ...p, [key]: value }));
    setBusy((b) => new Set(b).add(key));
    try {
      const res = await fetch("/api/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: { [key]: value } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.reason || "save_failed");
      setPrefs(data.prefs);
      flash("ok", "Saved — applies to your very next message.");
    } catch {
      setPrefs((p) => {
        const next = { ...p };
        if (before === undefined) delete next[key];
        else next[key] = before;
        return next;
      });
      flash("err", "Couldn't save that change — please try again.");
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(key);
        return n;
      });
    }
  }

  const paused = prefs.paused === true;
  const onCount = NOTIFICATION_CATEGORIES.filter((c) => prefs[c.key] !== false).length;

  return (
    <div className="conn-wrap set-wrap">
      <div className="conn-top">
        <button className="conn-back" onClick={() => router.push("/dashboard")}>← Dashboard</button>
        <span className="diag-eyebrow">Settings</span>
      </div>

      <div className="conn-head">
        <h1>Choose what <span className="hl">reaches you.</span></h1>
        <p>
          Switch off any message you don&apos;t want. Your dashboard, scores and history keep working exactly the
          same — this only controls what we send you by text or email.
        </p>
      </div>

      {billing && (
        <div className="set-card set-billing" id="billing">
          <div className="set-row">
            <div className="set-text">
              <span className="set-count" style={{ margin: 0 }}>Plan &amp; billing</span>
              <h3 style={{ marginTop: 6 }}>{billing.plan.name}</h3>
              <p>
                <b className="set-price">{billing.plan.amount}</b> / {billing.plan.interval} · cancel anytime ·{" "}
                <span className={`set-pill set-pill-${billing.state}`}>{BILLING_STATUS[billing.state].label}</span>
              </p>
              <p style={{ marginTop: 6 }}>{BILLING_STATUS[billing.state].note}</p>
            </div>
            {(billing.state === "none" || billing.state === "cancelled") && (
              <button className="btn btn-primary" onClick={() => router.push("/payment")}>Subscribe — {billing.plan.amount}/mo</button>
            )}
            {billing.canManage && billing.state !== "none" && (
              <button className="btn btn-ghost" disabled={portalBusy} onClick={openPortal}>
                {portalBusy ? "Opening…" : "Manage billing"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="set-count" style={{ marginTop: 22 }}>Notifications</div>

      {load === "loading" && <p className="set-note">Loading your settings…</p>}
      {load === "error" && (
        <p className="set-note set-err">Couldn&apos;t load your settings. Refresh the page, or try again in a minute.</p>
      )}
      {load === "not_provisioned" && (
        <p className="set-note">Your coaching isn&apos;t set up yet — finish setup on the dashboard, then come back here.</p>
      )}

      {load === "ready" && (
        <>
          <div className={`set-card set-master${paused ? " is-paused" : ""}`}>
            <div className="set-row">
              <div className="set-text">
                <h3>Pause all messages</h3>
                <p>
                  {paused
                    ? "Everything below is on hold. Switch this off to resume exactly as you had it."
                    : "One switch to stop every coaching message for now — your choices below are remembered."}
                </p>
              </div>
              <Switch
                label="Pause all messages"
                checked={paused}
                busy={busy.has("paused")}
                onChange={(v) => toggle("paused", v)}
              />
            </div>
          </div>

          <div className="set-count" style={{ marginTop: 6 }}>
            {paused ? "Paused" : `${onCount} of ${NOTIFICATION_CATEGORIES.length} message types on`}
          </div>

          <div className={`set-card${paused ? " set-dim" : ""}`}>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <div className="set-row" key={c.key}>
                <div className="set-text">
                  <h3>{c.title}</h3>
                  <p>{c.blurb}</p>
                </div>
                <Switch
                  label={c.title}
                  checked={prefs[c.key] !== false}
                  busy={busy.has(c.key)}
                  onChange={(v) => toggle(c.key, v)}
                />
              </div>
            ))}
          </div>

          <p className="set-foot">
            Replies to messages you send us are always delivered, whatever you choose here.
          </p>
        </>
      )}

      <div className="set-toast" role="status" aria-live="polite">
        {msg && <span className={msg.kind === "err" ? "set-toast-err" : "set-toast-ok"}>{msg.text}</span>}
      </div>
    </div>
  );
}

function Switch({ label, checked, busy, onChange }: { label: string; checked: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      className={`set-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="set-knob" />
    </button>
  );
}
