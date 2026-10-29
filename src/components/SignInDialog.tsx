import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { LogIn, Wallet, X } from "lucide-react";
import { useSignInWithEmail, useVerifyEmailOTP } from "@coinbase/cdp-hooks";
import { useSignIn } from "../hooks/useSignIn";
import styles from "../App.module.css";
import d from "./SignInDialog.module.css";

const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

/**
 * The one place to sign in. With an email: we send a code, and the person types it in. The first time, a wallet is made
 * for them, and once the code is right it connects by itself. People who already have a wallet use it from the link under
 * the email. It is drawn on the page itself, not where it is used: the header clips and stacks what is inside it, so from
 * there it would open behind the page.
 */
export function SignInDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { isPending, error: walletError, withBrowserWallet } = useSignIn();
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

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <section className={styles.modal} style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sign in">
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 className={styles.modalTitle}>
          <LogIn size={18} style={{ verticalAlign: "-3px" }} /> Sign in
        </h2>
        {flowId === null ? (
          <form onSubmit={sendCode} style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            <p className={styles.muted}>We email you a code. No wallet app, no seed phrase. The first time, a wallet is made for you.</p>
            <input className={styles.input} type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" autoComplete="email" autoFocus required />
            <button className={styles.button} disabled={working || !email.includes("@")}>
              {working ? "Sending…" : "Email me a code"}
            </button>
            <div className={d.or}>or</div>
            <button
              type="button"
              className={`${styles.ghostButton} ${d.wallet}`}
              disabled={isPending}
              onClick={() =>
                withBrowserWallet(() => {
                  onDone?.();
                  onClose();
                })
              }
            >
              <Wallet size={16} /> Use MetaMask or another wallet
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
        {(error ?? walletError) && <p className={styles.error}>{error ?? walletError}</p>}
      </section>
    </div>,
    document.body,
  );
}
