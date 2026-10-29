import { useState } from "react";
import { Mail, Wallet } from "lucide-react";
import { useSignIn } from "../hooks/useSignIn";
import { SignInDialog } from "./SignInDialog";
import styles from "../App.module.css";

/** Sign in with an email, or with a wallet you already have. `compact` is for the header. */
export function SignInButtons({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const { emailAvailable, isPending, error, withBrowserWallet } = useSignIn();
  const [open, setOpen] = useState(false);
  return (
    <>
      {emailAvailable && (
        <button className={styles.button} onClick={() => setOpen(true)}>
          <Mail size={16} /> {compact ? "Sign in" : "Sign in with your email"}
        </button>
      )}
      <button className={emailAvailable ? styles.ghostButton : styles.button} disabled={isPending} onClick={() => withBrowserWallet(onDone)} title="Connect MetaMask or another browser wallet">
        <Wallet size={16} /> {emailAvailable ? (compact ? "MetaMask" : "I have MetaMask") : "Connect MetaMask"}
      </button>
      {error && !compact && <p className={styles.error}>{error}</p>}
      {open && <SignInDialog onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}
