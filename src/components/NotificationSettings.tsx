import { useState } from "react";
import { useAccount } from "wagmi";
import { Mail, X } from "lucide-react";
import { emailApi, type EmailStatus } from "../lib/api";
import { sessionToken } from "../lib/files";
import styles from "../App.module.css";

const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

/** A small dialog to get an email when a job is funded (freelancers) or work is submitted (clients). */
export function NotificationSettings({ onClose }: { onClose: () => void }) {
  const { address } = useAccount();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  // Every call needs a signature from the wallet, so nothing happens until the person asks.
  const run = async (label: string, work: (token: string) => Promise<EmailStatus>) => {
    if (!address) return;
    setError(null);
    setWorking(label);
    try {
      setStatus(await work(await sessionToken(address)));
    } catch (e) {
      setError(firstLine(e));
    } finally {
      setWorking("");
    }
  };

  const busy = !!working;
  return (
    <div className={styles.overlay} onClick={onClose}>
      <section className={styles.modal} style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Email notifications">
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 className={styles.modalTitle}>
          <Mail size={18} style={{ verticalAlign: "-3px" }} /> Email notifications
        </h2>
        <p className={styles.muted}>Get an email when a job you were hired for is funded, and when work you hired for is submitted. We only email confirmed addresses, and every email has an unsubscribe link.</p>

        {!status && !asked && (
          <button
            className={styles.button}
            disabled={busy}
            onClick={() => {
              setAsked(true);
              void run("Check your wallet…", emailApi.get);
            }}
          >
            {working || "Sign in with my wallet to continue"}
          </button>
        )}

        {(status || (asked && !working && error === null)) && (
          <>
            {status?.email && (
              <p>
                {status.email} <span className={`${styles.badge} ${status.verified ? styles.tier_good : styles.tier_mixed}`}>{status.verified ? "Confirmed" : "Waiting for confirmation"}</span>
              </p>
            )}
            {status?.email && !status.verified && <p className={styles.muted}>We sent you a link. Open it to start getting notifications.</p>}
            <input className={styles.input} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" />
            <div style={{ display: "flex", gap: ".5rem" }}>
              <button className={styles.button} disabled={busy || !email.includes("@")} onClick={() => run("Saving…", (t) => emailApi.set(t, email.trim()))}>
                {working || (status?.email ? "Change email" : "Send confirmation")}
              </button>
              {status?.email && (
                <button className={styles.ghostButton} disabled={busy} onClick={() => run("Removing…", emailApi.remove)}>
                  Stop emails
                </button>
              )}
            </div>
          </>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </section>
    </div>
  );
}
