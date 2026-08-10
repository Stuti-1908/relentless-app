import type { Metadata } from "next";
import Link from "next/link";
import styles from "./welcome.module.css";

export const metadata: Metadata = {
  title: "Relentless AI — Your Executive in the Pocket",
  description:
    "A personal executive coach in your pocket — showing up every day, in your corner, pushing you toward the business you said you wanted.",
};

export default function WelcomePage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.wrap}>
          <div className={styles.logo}>
            <img src="/icon-192.png" alt="Relentless" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <p className={styles.eyebrow}>Relentless AI · Private Beta</p>
          <h1>
            The coach who <span className={styles.accent}>never</span> clocks out.
          </h1>
          <p className={styles.lede}>
            A personal executive coach in your pocket — showing up every day, in your corner,
            pushing you toward the business you said you wanted.
          </p>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.wrap}>
          <p className={styles.thesis}>
            Most founders don&apos;t fail from a lack of ideas. They drift — busy, unaccountable,
            alone with the hard calls.{" "}
            <span className={styles.accentPlain}>Relentless is the antidote.</span>
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>What it feels like</p>
          <h2>A week with someone in your corner</h2>
          <p className={styles.sub}>
            Not another app to check. A coach that reaches out first — and adapts to how your week
            is actually going.
          </p>

          <div className={styles.rhythm}>
            <div className={styles.beat}>
              <div className={styles.when}>Each morning</div>
              <div className={styles.what}>
                <strong>A briefing built for today</strong>
                <span>
                  Your priorities, your energy, your goals — distilled into one sharp message that
                  tells you where to point your day.
                </span>
              </div>
            </div>
            <div className={styles.beat}>
              <div className={styles.when}>Through the day</div>
              <div className={styles.what}>
                <strong>Nudges when they matter</strong>
                <span>
                  Timely, personal pushes — never spam. A reminder to protect your deep work, seize
                  momentum, or stop and rest.
                </span>
              </div>
            </div>
            <div className={styles.beat}>
              <div className={styles.when}>Each evening</div>
              <div className={styles.what}>
                <strong>An honest score</strong>
                <span>
                  How the day actually went — readiness, focus, execution — so patterns surface
                  before they cost you.
                </span>
              </div>
            </div>
            <div className={styles.beat}>
              <div className={styles.when}>Weekly</div>
              <div className={styles.what}>
                <strong>The partner check-in</strong>
                <span>
                  A straight-talk read on cash, risk, and team — then one clear lever to pull. The
                  conversation a great co-founder would force.
                </span>
              </div>
            </div>
            <div className={styles.beat}>
              <div className={styles.when}>Always on</div>
              <div className={styles.what}>
                <strong>Market intelligence</strong>
                <span>
                  The one signal in the noise that actually matters to your business this week — and
                  what to do about it.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Why it&apos;s different</p>
          <h2>Built to move you, not manage you</h2>
          <div className={styles.grid}>
            <div className={styles.valueCard}>
              <h3>It knows your context</h3>
              <p>
                Your goals, your stage, your priorities, how you&apos;re actually feeling. Every
                message is written for you — never a generic template.
              </p>
            </div>
            <div className={styles.valueCard}>
              <h3>It adapts to your reality</h3>
              <p>
                Running on empty? It lightens the day. Firing on all cylinders? It tells you to
                seize it. Coaching that meets you where you are.
              </p>
            </div>
            <div className={styles.valueCard}>
              <h3>It closes the loop</h3>
              <p>
                Reply in plain language. It listens, scores, and adjusts — a real back-and-forth,
                not a one-way broadcast.
              </p>
            </div>
            <div className={styles.valueCard}>
              <h3>It lives where you do</h3>
              <p>
                A clean dashboard and messages that come to you. No new habit to build, no dashboard
                you have to remember to open.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.wrap}>
          <div className={styles.beta}>
            <p className={styles.eyebrow}>The invitation</p>
            <h2>Be one of our first.</h2>
            <p className={styles.body}>
              We&apos;re opening a small private beta to a handful of founders and operators who want
              a sharper edge. You get the full experience — and a direct line to shape it.
            </p>
            <ul className={styles.terms}>
              <li>Full access, free for the beta period</li>
              <li>Personal onboarding — dialed to your goals</li>
              <li>Your feedback directly shapes the product</li>
              <li>Locked-in founding-member pricing when we launch</li>
            </ul>
            <Link className={styles.cta} href="/login?mode=signup">
              Claim your beta seat
            </Link>
            <p className={styles.fine}>Limited seats · Serious operators only</p>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <p>
            <span className={styles.mk}>RELENTLESS AI</span>
            <br />
            Your executive coach — in your pocket, every day.
          </p>
        </div>
      </footer>
    </main>
  );
}
