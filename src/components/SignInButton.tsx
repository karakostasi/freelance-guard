import { useState, type ReactNode } from "react";
import { LogIn } from "lucide-react";
import { useSignIn } from "../hooks/useSignIn";
import { SignInDialog } from "./SignInDialog";
import styles from "../App.module.css";
import s from "./SignInButton.module.css";

/**
 * The one way in, wherever it is on the page. It opens the sign-in dialog (an email, or a wallet you already have). Where
 * the email login isn't set up there is only a browser wallet, so it connects that straight away. `children` is the
 * label, and `className` replaces the look. `onDone` runs once the person is in.
 */
export function SignInButton({ children, className, onDone }: { children?: ReactNode; className?: string; onDone?: () => void }) {
  const { emailAvailable, isPending, error, withBrowserWallet } = useSignIn();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className ?? `${styles.button} ${s.btn}`} disabled={isPending} onClick={() => (emailAvailable ? setOpen(true) : withBrowserWallet(onDone))}>
        {children ?? (
          <>
            <LogIn size={16} /> Sign in
          </>
        )}
      </button>
      {error && !emailAvailable && <p className={styles.error}>{error}</p>}
      {open && <SignInDialog onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}
