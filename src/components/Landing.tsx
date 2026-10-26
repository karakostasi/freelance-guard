import { useRef } from "react";
import { useAccount, useConnect } from "wagmi";
import { ArrowRight, Banknote, Eye, FileCheck, Lock, Scale, Send, ShieldCheck, Wallet } from "lucide-react";
import { navigate } from "../hooks/useHashRoute";
import styles from "../App.module.css";
import page from "./Landing.module.css";

const STEPS = [
  { icon: Lock, title: "Fund", text: "Payer locks the payment in escrow." },
  { icon: Send, title: "Deliver", text: "Payee submits the work." },
  { icon: FileCheck, title: "Review", text: "Payer approves or disputes." },
  { icon: Banknote, title: "Get paid", text: "Funds release on approval." },
];

const BENEFITS = [
  { icon: ShieldCheck, title: "Safe for payers", text: "Money moves only when you approve.", accent: "#4f7cff", size: "span3", chip: "Funds locked until approval" },
  { icon: Wallet, title: "Safe for payees", text: "Payment is locked in before you start.", accent: "#3ecf8e", size: "span3", chip: "Paid on approval" },
  { icon: Scale, title: "Fair disputes", text: "A neutral arbiter decides.", accent: "#f5b942", size: "span2", chip: "" },
  { icon: Eye, title: "Transparent", text: "Every step is on-chain.", accent: "#a78bfa", size: "span4", chip: "0x7a3f…c91e · On-chain" },
] as const;

export function Landing() {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const how = useRef<HTMLElement>(null);

  const start = () => {
    if (isConnected) navigate("/jobs");
    else connect({ connector: connectors[0] }, { onSuccess: () => navigate("/jobs") });
  };

  return (
    <div className={page.landing}>
      <section className={page.hero}>
        <span className={page.eyebrow}>Escrow for freelance work</span>
        <h2 className={page.headline}>Get paid for your work. Pay only for work you approve.</h2>
        <p className={page.lead}>Freelance Guard holds the payment in escrow until the work is approved.</p>
        <div className={page.cta}>
          <button className={`${styles.button} ${page.primary}`} onClick={start} disabled={isPending}>
            {isConnected ? "Open the app" : "Connect wallet to start"} <ArrowRight size={16} />
          </button>
          <button className={styles.ghostButton} onClick={() => how.current?.scrollIntoView({ behavior: "smooth" })}>
            See how it works
          </button>
        </div>
        {error && <p className={styles.error}>{error.message.split("\n")[0]}</p>}
        <p className={page.note}>Testnet demo. No real money.</p>
      </section>

      <section ref={how} className={page.section}>
        <h3 className={page.title}>How it works</h3>
        <ol className={page.timeline}>
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className={page.node}>
              <span className={page.circle}>
                <Icon size={24} />
                <span className={page.nodeNumber}>{i + 1}</span>
              </span>
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={page.section}>
        <h3 className={page.title}>Why Freelance Guard</h3>
        <div className={page.bento}>
          {BENEFITS.map(({ icon: Icon, title, text, accent, size, chip }) => (
            <div key={title} className={`${page.tile} ${page[size]}`} style={{ "--accent": accent } as React.CSSProperties}>
              <span className={page.tileIcon}>
                <Icon size={22} />
              </span>
              <strong>{title}</strong>
              <p>{text}</p>
              {chip && <span className={page.chip}>{chip}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className={page.section}>
        <h3 className={page.title}>Pay in euros</h3>
        <p className={page.lead}>We convert and deposit into escrow for you. Providers are sandboxes for now.</p>
        <div className={page.cta}>
          <button className={styles.ghostButton} onClick={() => navigate("/flow")}>
            See the payment flow <ArrowRight size={14} />
          </button>
        </div>
      </section>

      <section className={page.final}>
        <h3 className={page.title}>Ready to try it?</h3>
        <button className={`${styles.button} ${page.primary}`} onClick={start} disabled={isPending}>
          {isConnected ? "Open the app" : "Connect wallet to start"} <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}
