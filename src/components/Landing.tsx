import { useRef } from "react";
import { useSession } from "../hooks/useSession";
import { isMainnet } from "../chain";
import { ArrowRight, Banknote, Coins, CreditCard, FileCheck, FileText, Landmark, ListChecks, Lock, Mail, MapPin, Scale, Send, TrendingUp, UserCheck } from "lucide-react";
import { navigate } from "../hooks/useHashRoute";
import { JobPreview } from "./JobPreview";
import { SignInButton } from "./SignInButton";
import styles from "../App.module.css";
import page from "./Landing.module.css";

const STEPS = [
  { icon: Lock, title: "Fund" },
  { icon: Send, title: "Deliver" },
  { icon: FileCheck, title: "Review" },
  { icon: Banknote, title: "Get paid" },
];

// What the app can do, in two or three words each. They scroll past as a ribbon.
const RIBBON = [
  { icon: Mail, text: "No wallet needed" },
  { icon: ListChecks, text: "Pay in stages" },
  { icon: CreditCard, text: "Euros or dollars" },
  { icon: TrendingUp, text: "Earn yield" },
  { icon: UserCheck, text: "Verifier" },
  { icon: Scale, text: "Fair disputes" },
  { icon: FileText, text: "Receipts" },
  { icon: Landmark, text: "Paid to your bank" },
];

/** The page you land on, and the one the logo leads to. Everything on it leads to the same place: the app once you are in, the sign-in dialog until then. */
export function Landing() {
  const { isConnected, restoring } = useSession();
  const how = useRef<HTMLElement>(null);

  // Someone whose session is coming back is treated as inside, so the page doesn't ask them to sign in for a moment.
  const start = isConnected || restoring ? (
    <button className={`${styles.button} ${page.primary}`} onClick={() => navigate("/jobs")}>
      Open the app <ArrowRight size={16} />
    </button>
  ) : (
    <SignInButton className={`${styles.button} ${page.primary}`} onDone={() => navigate("/jobs")}>
      Get started <ArrowRight size={16} />
    </SignInButton>
  );

  return (
    <div className={page.landing}>
      <section className={page.hero}>
        <div className={page.copy}>
          <span className={page.eyebrow}>Milestone escrow for business payments</span>
          <h2 className={page.headline}>
            Get paid for your work. <span className={page.grad}>Pay only for work you approve.</span>
          </h2>
          <p className={page.lead}>Payments sit in escrow and are released stage by stage.</p>
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

      <div className={page.ribbon} aria-label="What Squirrel does">
        <ul className={page.track}>
          {[...RIBBON, ...RIBBON].map(({ icon: Icon, text }, i) => (
            <li key={i} className={i >= RIBBON.length ? page.copy2 : undefined} aria-hidden={i >= RIBBON.length}>
              <Icon size={15} /> {text}
            </li>
          ))}
        </ul>
      </div>

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
          {STEPS.map(({ icon: Icon, title }, i) => (
            <li key={title} className={page.step}>
              <span className={page.circle}>
                <Icon size={20} />
                <span className={page.stepNumber}>{i + 1}</span>
              </span>
              <strong>{title}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className={page.final}>
        <h3 className={page.finalTitle}>Ready to try it?</h3>
        <div className={page.cta}>
          {start}
          <button className={styles.ghostButton} onClick={() => navigate("/flow")}>
            See the payment flow <ArrowRight size={14} />
          </button>
        </div>
      </section>
    </div>
  );
}
