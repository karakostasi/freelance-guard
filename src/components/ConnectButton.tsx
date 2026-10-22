import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useConnect, type Connector } from "wagmi";
import { Fingerprint, Wallet, X } from "lucide-react";
import styles from "../App.module.css";

const PASSKEY_ID = "baseAccount";

// If the optional passkey package isn't installed, say that plainly instead of showing a bundler error.
const explain = (message: string) =>
  /resolve|import/i.test(message) ? "Passkey sign-in isn't available on this site yet. Use MetaMask for now." : message.split("\\n")[0];

/**
 * A "sign in" button that opens a chooser: a passkey (fingerprint or face, no wallet or crypto needed) or
 * MetaMask for people who already have one.
 */
export function ConnectButton({ className, children, onConnected }: { className?: string; children: ReactNode; onConnected?: () => void }) {
  const [open, setOpen] = useState(false);
  const { connectors, connect, isPending, variables, error, reset } = useConnect();

  const passkey = connectors.find((c) => c.id === PASSKEY_ID);
  const metaMask = connectors.find((c) => c.id !== PASSKEY_ID);
  const hasMetaMask = typeof window !== "undefined" && "ethereum" in window;

  const close = () => {
    setOpen(false);
    reset();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const go = (connector: Connector) =>
    connect(
      { connector },
      {
        onSuccess: () => {
          close();
          onConnected?.();
        },
      },
    );
  const pendingId = isPending ? variables?.connector && "id" in variables.connector && variables.connector.id : null;

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open &&
        createPortal(
          <div className={styles.overlay} onClick={close}>
            <section className={`${styles.modal} ${styles.connectModal}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sign in">
              <button className={styles.close} onClick={close} aria-label="Close">
                <X size={18} />
              </button>
              <h2 className={styles.modalTitle}>Sign in to Freelance Guard</h2>
              <p className={styles.muted}>Choose how you want to continue.</p>
              <div className={styles.connectOptions}>
                {passkey && (
                  <button className={`${styles.connectOption} ${styles.connectRecommended}`} disabled={isPending} onClick={() => go(passkey)}>
                    <Fingerprint size={26} />
                    <span>
                      <strong>Continue with a passkey</strong>
                      <span className={styles.muted}>Use your fingerprint or face. No wallet or crypto needed, and we cover the network fees.</span>
                      <span className={styles.connectBadge}>{pendingId === PASSKEY_ID ? "Opening…" : "Recommended"}</span>
                    </span>
                  </button>
                )}
                {metaMask && (
                  <button className={styles.connectOption} disabled={isPending || !hasMetaMask} onClick={() => go(metaMask)}>
                    <Wallet size={26} />
                    <span>
                      <strong>Use MetaMask</strong>
                      <span className={styles.muted}>{hasMetaMask ? "For people who already have a crypto wallet." : "MetaMask isn't installed in this browser."}</span>
                      {pendingId === metaMask.id && <span className={styles.connectBadge}>Opening…</span>}
                    </span>
                  </button>
                )}
              </div>
              {error && <p className={styles.error}>{explain(error.message)}</p>}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
