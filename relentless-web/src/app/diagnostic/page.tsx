"use client";

import { useMemo, useState } from "react";
import { QUESTIONS, diagnose, MAX_SCORE, type Choice } from "@/lib/diagnostic";

type Stage = "intro" | "quiz" | "result";

export default function DiagnosticPage() {
  const [stage, setStage] = useState<Stage>("intro");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Choice>>({});

  // lead capture
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [biz, setBiz] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const total = QUESTIONS.length;
  const q = QUESTIONS[step];
  const result = useMemo(
    () => (stage === "result" ? diagnose(answers) : null),
    [stage, answers]
  );

  function choose(key: Choice) {
    setAnswers((a) => ({ ...a, [q.id]: key }));
    // auto-advance after a beat
    window.setTimeout(() => {
      if (step < total - 1) setStep((s) => s + 1);
      else setStage("result");
    }, 180);
  }

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    if (!result || (!email.trim() && !phone.trim())) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          businessType: biz,
          totalScore: result.totalScore,
          topConstraint: result.primary.title,
          answersJson: JSON.stringify(answers),
          diagnosis: `${result.band.label} (${result.totalScore}/${MAX_SCORE}). Primary: ${result.primary.title}. ${result.primary.why}`,
        }),
      });
      const d = await res.json();
      if (d.ok) setSaved(true);
      else setSaveErr("Could not save — try again, or text us directly.");
    } catch {
      setSaveErr("Could not save — check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  const band = (n: number) => (n >= 3 ? "good" : n >= 2 ? "mid" : "low");

  return (
    <div className="diag-wrap">
      <div className="diag-top">
        <span className="brand">RELENTLESS<span className="dot"> AI</span></span>
        <span className="diag-eyebrow">Free AI Business Audit</span>
      </div>

      {/* INTRO */}
      {stage === "intro" && (
        <div className="diag-card diag-hero">
          <span className="diag-eyebrow">SMB Growth Diagnostic</span>
          <h1 style={{ marginTop: 10 }}>
            Find out <span className="hl">exactly</span>{" "}why your business isn&apos;t growing
          </h1>
          <p>
            Answer 9 quick questions. Get a personalized diagnosis and the specific fixes for your
            situation — in under 3 minutes. No fluff.
          </p>
          <button className="btn btn-primary" onClick={() => setStage("quiz")}>
            Start the audit →
          </button>
        </div>
      )}

      {/* QUIZ */}
      {stage === "quiz" && q && (
        <div className="diag-card">
          <div className="diag-progress">
            {QUESTIONS.map((_, i) => (
              <span key={i} className={`seg${i <= step ? " on" : ""}`} />
            ))}
          </div>
          <div className="diag-qnum">
            Question {step + 1} of {total} — {q.eyebrow}
          </div>
          <div className="diag-q">{q.question}</div>
          {q.options.map((o) => (
            <button
              key={o.key}
              className={`diag-opt${answers[q.id] === o.key ? " sel" : ""}`}
              onClick={() => choose(o.key)}
            >
              <span className="key">{o.key}</span>
              <span className="otext">{o.label}</span>
            </button>
          ))}
          <div className="diag-nav">
            <button
              className="diag-back"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              ← Back
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {Object.keys(answers).length}/{total} answered
            </span>
          </div>
        </div>
      )}

      {/* RESULT */}
      {stage === "result" && result && (
        <div className="diag-card">
          <span className={`diag-band ${result.band.key}`}>{result.band.label}</span>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", margin: "6px 0 0" }}>
            Your growth score: <span style={{ fontFamily: "var(--font-mono)" }}>{result.totalScore}</span>
            <span style={{ color: "var(--muted)", fontSize: 18 }}>/{result.maxScore}</span>
          </h1>
          <div className="diag-scorebar">
            <i style={{ width: `${Math.round((result.totalScore / result.maxScore) * 100)}%` }} />
          </div>
          <p style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.6, margin: "10px 0 0" }}>
            {result.band.summary}
          </p>

          {/* Per-area mini scores */}
          <div className="diag-areas">
            {result.areaScores.map((a) => (
              <div className="diag-area" key={a.area}>
                <div className="al">{a.eyebrow}</div>
                <div className={`av ${band(a.score)}`}>{a.score}/3</div>
              </div>
            ))}
          </div>

          {/* Primary finding */}
          <div className="diag-finding primary">
            <h3>#1 bottleneck: {result.primary.title}</h3>
            <div className="lead">{result.primary.why}</div>
            {result.primary.fixes.map((f, i) => (
              <div className="diag-fix" key={i}>
                <span className="n">{i + 1}</span>
                <span>{f}</span>
              </div>
            ))}
            <div className="diag-rel">↳ {result.primary.relentless}</div>
          </div>

          {/* Secondary finding (only when also weak) */}
          {result.secondary && (
            <div className="diag-finding">
              <h3>Also holding you back: {result.secondary.title}</h3>
              <div className="lead">{result.secondary.why}</div>
              {result.secondary.fixes.map((f, i) => (
                <div className="diag-fix" key={i}>
                  <span className="n">{i + 1}</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}

          {/* Lead capture */}
          {!saved ? (
            <form className="diag-leadform" onSubmit={submitLead} style={{ marginTop: 22 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                Get your full plan + a daily AI briefing
              </h3>
              <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
                We&apos;ll send the complete breakdown and show you how Relentless AI fixes this — by text every morning.
              </p>
              <div className="stack">
                <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <input placeholder="Phone (for your daily briefing)" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <input placeholder="What does your business do?" value={biz} onChange={(e) => setBiz(e.target.value)} />
              </div>
              {saveErr && <div className="errbox" style={{ marginTop: 10 }}>{saveErr}</div>}
              <button
                className="btn btn-primary btn-block"
                style={{ marginTop: 14 }}
                disabled={saving || (!email.trim() && !phone.trim())}
              >
                {saving ? "Sending…" : "Send me my growth plan →"}
              </button>
              <p className="hint" style={{ marginTop: 12 }}>
                No spam. One email + one text. Unsubscribe anytime.
              </p>
            </form>
          ) : (
            <div className="diag-finding" style={{ marginTop: 22, borderColor: "#a7f3d0", background: "var(--green-light)" }}>
              <h3 style={{ color: "var(--green)" }}>✓ You&apos;re in.</h3>
              <div className="lead" style={{ marginBottom: 0 }}>
                Your full growth plan is on its way{name ? `, ${name.split(" ")[0]}` : ""}. Watch your inbox — and
                your phone tomorrow morning for your first Relentless briefing.
              </div>
            </div>
          )}
        </div>
      )}

      <p className="footer-note">Relentless AI · Digital Dada Technologies</p>
    </div>
  );
}
