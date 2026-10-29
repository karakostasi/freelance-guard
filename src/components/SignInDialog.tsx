import { useState, type FormEvent } from "react";
import { Mail, X } from "lucide-react";
import { useSignInWithEmail, useVerifyEmailOTP } from "@coinbase/cdp-hooks";
import styles from "../App.module.css";

const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

/**
 * Sign in with an email: we send a code, and the person types it in. The first time, a wallet is made for them. Once the
 * code is right the wallet connects by itself, so there is nothing else to do here.
 */
export function SignInDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setError(null);
    setWorking(true);
    try {
      await work();
    } catch (e) {
      setError(firstLine(e));
    } finally {
      setWorking(false);
    }
  };

  const sendCode = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => setFlowId((await signInWithEmail({ email: email.trim() })).flowId));
  };
  const verify = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await verifyEmailOTP({ flowId: flowId!, otp: code.trim() });
      onDone?.();
      onClose();
    });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <section className={styles.modal} style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sign in">
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 className={styles.modalTitle}>
          <Mail size={18} style={{ verticalAlign: "-3px" }} /> Sign in with your email
        </h2>
        {flowId === null ? (
          <form onSubmit={sendCode} style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            <p className={styles.muted}>We email you a code. No wallet app, no seed phrase. The first time, a wallet is made for you.</p>
            <input className={styles.input} type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" autoComplete="email" autoFocus required />
            <button className={styles.button} disabled={working || !email.includes("@")}>
              {working ? "Sending…" : "Email me a code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            <p className={styles.muted}>We sent a code to {email.trim()}. Type it here.</p>
            <input className={styles.input} inputMode="numeric" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code from the email" autoComplete="one-time-code" autoFocus required />
            <button className={styles.button} disabled={working || code.trim().length < 4}>
              {working ? "Checking…" : "Sign in"}
            </button>
            <button type="button" className={styles.textButton} onClick={() => (setFlowId(null), setCode(""), setError(null))}>
              Use another email
            </button>
          </form>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </section>
    </div>
  );
}
