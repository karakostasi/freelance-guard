import { ArrowRight, Banknote, FileCheck, LoaderCircle, Lock, Send, ShieldCheck, Wallet } from "lucide-react";
import logo from "../assets/logo.svg";
import { SignInButton } from "./SignInButton";
import styles from "../App.module.css";
import s from "./SignInGate.module.css";

type GatedPage = "new" | "jobs" | "flow";

const STOPS = [
  { icon: Lock, label: "Fund" },
  { icon: Send, label: "Deliver" },
  { icon: FileCheck, label: "Review" },
  { icon: Banknote, label: "Get paid" },
];

// What each page is for, and where on the way of a payment it sits.
const COPY: Record<GatedPage, { title: string; text: string; stop: number }> = {
  new: { title: "Hire someone, pay when it's done", text: "Lock the payment in escrow in three steps. It reaches them only when you approve their work.", stop: 0 },
  jobs: { title: "Every job, in one place", text: "See what you pay and what you earn, and the one thing to do next on each job.", stop: 2 },
  flow: { title: "Watch your money move", text: "Follow a payment from the bank to the escrow to the person who did the work, one step at a time.", stop: 1 },
};

const FACTS = [
  { icon: Wallet, text: "No wallet needed" },
  { icon: ShieldCheck, text: "Held until you approve" },
  { icon: Banknote, text: "Pay in euros or dollars" },
];

/**
 * The page for someone who isn't signed in, with the one way in. The header's own sign-in button hides while it shows.
 * `checking` is for someone who signed in before and whose wallet is still starting: the button waits, instead of asking
 * a person who is already in to sign in.
 */
export function SignInGate({ page, checking = false }: { page: GatedPage; checking?: boolean }) {
  const { title, text, stop } = COPY[page];
  return (
    <section className={s.gate} aria-label="Sign in">
      <img src={logo} alt="" className={s.mascot} />
      <ol className={s.chain} aria-hidden="true">
        <span className={s.rail} />
        {STOPS.map(({ icon: Icon, label }, i) => (
          <li key={label} className={`${s.stop} ${i === stop ? s.on : ""}`}>
            <span className={s.dot}>
              <Icon size={20} />
            </span>
            <span className={s.label}>{label}</span>
          </li>
        ))}
      </ol>
      <div className={s.card}>
        <span className={s.badge}>
          <Lock size={13} /> {checking ? "Welcome back" : "Sign in to continue"}
        </span>
        <h2 className={s.title}>{title}</h2>
        <p className={s.text}>{text}</p>
        {checking ? (
          <button className={`${styles.button} ${s.cta}`} disabled>
            <LoaderCircle size={18} className={s.spin} /> Checking your session…
          </button>
        ) : (
          <SignInButton className={`${styles.button} ${s.cta}`}>
            Sign in <ArrowRight size={18} />
          </SignInButton>
        )}
        <p className={s.note}>{checking ? "Just a moment." : "We email you a code. Already have a wallet? You can use that too."}</p>
        <ul className={s.facts}>
          {FACTS.map(({ icon: Icon, text: fact }) => (
            <li key={fact}>
              <Icon size={14} /> {fact}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
