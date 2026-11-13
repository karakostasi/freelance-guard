import { useRef, type CSSProperties } from "react";
import { useSession } from "../hooks/useSession";
import { isMainnet } from "../chain";
import { Banknote, Coins, CreditCard, FileCheck, Landmark, Lock, MapPin, Send } from "lucide-react";
import { navigate } from "../hooks/useHashRoute";
import { JobPreview } from "./JobPreview";
import { SignInButton } from "./SignInButton";
import styles from "../App.module.css";
import page from "./Landing.module.css";

// The four steps follow the colours a milestone has in the app: funded, submitted, submitted, paid.
const STEPS = [
  { icon: Lock, title: "Fund", text: "The payer locks the whole amount in escrow.", color: "var(--st-funded)" },
  { icon: Send, title: "Deliver", text: "The payee sends the work for each stage.", color: "var(--st-submitted)" },
  { icon: FileCheck, title: "Review", text: "The payer approves it, or disputes it within the review period.", color: "var(--st-submitted)" },
  { icon: Banknote, title: "Get paid", text: "Each approved stage is released to the payee.", color: "var(--st-paid)" },
];

/** The page you land on, and the one the logo leads to. Everything on it leads to the same place: the app once you are in, the sign-in dialog until then. */
export function Landing() {
  const { isConnected, restoring } = useSession();
  const how = useRef<HTMLElement>(null);

  // Someone whose session is coming back is treated as inside, so the page doesn't ask them to sign in for a moment.
  const start = isConnected || restoring ? (
    <button className={`${styles.button} ${page.primary}`} onClick={() => navigate("/jobs")}>
      Open the app
    </button>
  ) : (
    <SignInButton className={`${styles.button} ${page.primary}`} onDone={() => navigate("/jobs")}>
      Get started
    </SignInButton>
  );

  return (
    <div className={page.landing}>
      <section className={page.hero}>
        <div className={page.copy}>
          <h2 className={page.headline}>
            Get paid for your work. <span>Pay only for work you approve.</span>
          </h2>
          <p className={page.lead}>Milestone escrow for business payments. The money sits in escrow and is released stage by stage.</p>
          <div className={page.cta}>
            {start}
            <button className={styles.ghostButton} onClick={() => how.current?.scrollIntoView({ behavior: "smooth" })}>
              See how it works
            </button>
          </div>
          <p className={page.note}>{isMainnet ? "No wallet needed." : "No wallet needed. Testnet demo, no real money."}</p>
        </div>
        <JobPreview />
      </section>

      <section className={page.section}>
        <h3 className={page.title}>Pay in euros or dollars. They get paid their way.</h3>
        <div className={page.route}>
          <div className={page.node}>
            <span className={page.nodeIcons}>
              <CreditCard size={20} />
              <Landmark size={20} />
            </span>
            <strong>You pay</strong>
            <span>Card or bank, € or $</span>
            <span className={page.where}>
              <MapPin size={12} /> Becomes a stablecoin in your wallet
            </span>
          </div>
          <span className={page.wire} aria-hidden="true" />
          <div className={`${page.node} ${page.escrow}`}>
            <span className={page.nodeIcons}>
              <Lock size={20} />
            </span>
            <strong>Escrow</strong>
            <span>Held until you approve</span>
            <span className={page.where}>
              <MapPin size={12} /> A smart contract on Base holds it
            </span>
          </div>
          <span className={page.wire} aria-hidden="true" />
          <div className={page.node}>
            <strong>They choose</strong>
            <ul className={page.choices}>
              <li>
                <Landmark size={14} /> Bank in €
              </li>
              <li>
                <Landmark size={14} /> Bank in $
              </li>
              <li>
                <Coins size={14} /> Stablecoin
              </li>
            </ul>
            <span className={page.where}>
              <MapPin size={12} /> To their bank, or kept in their wallet
            </span>
          </div>
        </div>
      </section>

      <section ref={how} className={page.section}>
        <h3 className={page.title}>How it works</h3>
        <ol className={page.steps}>
          {STEPS.map(({ icon: Icon, title, text, color }) => (
            <li key={title} className={page.step} style={{ "--c": color } as CSSProperties}>
              <strong className={page.stepTitle}>
                <Icon size={18} /> {title}
              </strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={page.final}>
        <h3 className={page.finalTitle}>Ready to try it?</h3>
        <div className={page.cta}>
          {start}
          <button className={styles.ghostButton} onClick={() => navigate("/flow")}>
            See the payment flow
          </button>
        </div>
      </section>
    </div>
  );
}
