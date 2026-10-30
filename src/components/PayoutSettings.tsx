import { useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Landmark, X } from "lucide-react";
import { payoutApi, type PayoutChoice } from "../lib/api";
import { sessionToken } from "../lib/files";
import { useEmailWallet } from "../hooks/useEmailWallet";
import { useBackendStatus } from "../hooks/useBackend";
import styles from "../App.module.css";
import p from "./PayoutSettings.module.css";

type Way = "sepa" | "ach" | "eurc";

const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

const ALL_WAYS: { way: Way; title: string; text: string }[] = [
  { way: "sepa", title: "A bank account in euros", text: "Paid by SEPA transfer to an IBAN." },
  { way: "ach", title: "A US bank account in dollars", text: "Paid by ACH to a routing and account number." },
  { way: "eurc", title: "Keep the stablecoin", text: "EURC or USDC stays in your wallet. Nothing is converted." },
];

/**
 * Where the payee wants the money to go when a payment is released. The payer doesn't decide that. It can be changed
 * until the payment is released. Everything needs a signature from the wallet, so nothing happens until they ask.
 */
export function PayoutSettings({ onClose }: { onClose: () => void }) {
  const { address } = useAccount();
  // Bank accounts are only taken where something can pay them out. Until then keeping the stablecoin is the only way.
  const { bankRails } = useBackendStatus();
  const ways = bankRails ? ALL_WAYS : ALL_WAYS.filter((w) => w.way === "eurc");
  const queryClient = useQueryClient();
  const [picked, setWay] = useState<Way>("sepa");
  // What is shown selected: the choice, unless it isn't on offer (the bank rails closed after the page loaded).
  const way: Way = ways.some((w) => w.way === picked) ? picked : "eurc";
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, work: (token: string) => Promise<void>) => {
    if (!address) return;
    setError(null);
    setSaved(false);
    setWorking(label);
    try {
      await work(await sessionToken(address));
      await queryClient.invalidateQueries({ queryKey: ["payout"] });
      // A payment that waited for this choice goes ahead now.
      await queryClient.invalidateQueries({ queryKey: ["run-of-job"] });
    } catch (e) {
      setError(firstLine(e));
    } finally {
      setWorking("");
    }
  };

  const show = (choice: PayoutChoice) => {
    if (choice.route) setWay(choice.route);
    setHolder(choice.holder ?? "");
    setIban(choice.iban ?? "");
    setRouting(choice.routing ?? "");
    setAccount(choice.account ?? "");
    setLoaded(true);
  };

  const save = () =>
    run("Saving…", async (token) => {
      await payoutApi.set(token, way === "eurc" ? { route: "eurc" } : way === "sepa" ? { route: "sepa", holder, iban } : { route: "ach", holder, routing, account });
      setSaved(true);
    });

  const load = () => run("Loading…", async (token) => show(await payoutApi.get(token)));
  // An email login signs by itself, so it just loads. A browser wallet asks first.
  const emailWallet = useEmailWallet(load);

  const busy = !!working;
  return (
    <div className={styles.overlay} onClick={onClose}>
      <section className={styles.modal} style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How you get paid">
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 className={styles.modalTitle}>
          <Landmark size={18} style={{ verticalAlign: "-3px" }} /> How you get paid
        </h2>
        <p className={styles.muted}>When a payer releases a payment to you, this is where it goes. The payer doesn&apos;t choose that, you do. You can change it until the payment is released.</p>

        {!loaded ? (
          emailWallet && !error ? (
            <p className={styles.muted}>Loading…</p>
          ) : (
            <button className={styles.button} disabled={busy} onClick={load}>
              {working || (error ? "Try again" : "Confirm in your wallet to continue")}
            </button>
          )
        ) : (
          <>
            <div className={p.ways} role="radiogroup" aria-label="Where the money goes">
              {ways.map((w) => (
                <label key={w.way} className={`${p.way} ${way === w.way ? p.wayOn : ""}`}>
                  <input type="radio" name="way" checked={way === w.way} onChange={() => setWay(w.way)} />
                  <span>
                    <b>{w.title}</b>
                    <span className={styles.muted}>{w.text}</span>
                  </span>
                </label>
              ))}
            </div>
            {way !== "eurc" && <input className={styles.input} placeholder="Name of the account holder" value={holder} onChange={(e) => setHolder(e.target.value)} aria-label="Account holder" maxLength={80} />}
            {way === "sepa" && <input className={`${styles.input} ${p.mono}`} placeholder="IBAN" value={iban} onChange={(e) => setIban(e.target.value)} aria-label="IBAN" autoComplete="off" spellCheck={false} />}
            {way === "ach" && (
              <div className={styles.amountRow}>
                <input className={`${styles.input} ${p.mono}`} placeholder="Routing number" value={routing} onChange={(e) => setRouting(e.target.value)} aria-label="Routing number" inputMode="numeric" autoComplete="off" />
                <input className={`${styles.input} ${p.mono}`} placeholder="Account number" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account number" inputMode="numeric" autoComplete="off" />
              </div>
            )}
            {way !== "eurc" && <span className={styles.muted}>This is a sandbox: no money moves. Only the last four digits of the account are ever shown to anyone else.</span>}
            <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
              <button className={styles.button} disabled={busy} onClick={save}>
                {working || "Save"}
              </button>
              {saved && <span className={p.ok}>Saved</span>}
            </div>
          </>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </section>
    </div>
  );
}
