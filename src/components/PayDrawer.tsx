import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { isAddress } from "viem";
import { EUR_PER_ETH, type PayoutRoute } from "../lib/fiatFlow";
import { euro } from "../lib/jobs";
import type { FundingForm } from "../hooks/useFiatFunding";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

/** Side drawer with the "fund a job with euros" form. */
export function PayDrawer({ backendOnline, onClose, onSubmit }: { backendOnline: boolean; onClose: () => void; onSubmit: (form: FundingForm) => void }) {
  const [freelancer, setFreelancer] = useState("");
  const [amountEth, setAmountEth] = useState("");
  const [days, setDays] = useState("");
  const [description, setDescription] = useState("");
  const [route, setRoute] = useState<PayoutRoute>("sepa");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const eur = Number(amountEth) * EUR_PER_ETH;
  const valid = isAddress(freelancer) && Number(amountEth) > 0 && Number(days) > 0;

  return (
    <div className={page.drawerOverlay} onClick={onClose}>
      <aside className={page.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={page.drawerHeader}>
          <h3>Fund a job with euros</h3>
          <button className={page.iconButton} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <input className={styles.input} placeholder="Freelancer address (0x…)" value={freelancer} onChange={(e) => setFreelancer(e.target.value)} />
        <div className={styles.suffixField}>
          <input className={styles.input} placeholder="Amount (ETH)" value={amountEth} onChange={(e) => setAmountEth(e.target.value)} />
          <span className={styles.suffix}>{Number(amountEth) > 0 ? `≈ ${euro(eur)}` : "ETH"}</span>
        </div>
        <div className={styles.suffixField}>
          <input className={styles.input} placeholder="Days to deliver" value={days} onChange={(e) => setDays(e.target.value)} />
          <span className={styles.suffix}>days</span>
        </div>
        <textarea className={styles.input} placeholder="Job description or IPFS link" value={description} onChange={(e) => setDescription(e.target.value)} />
        {backendOnline && (
          <select className={styles.input} value={route} onChange={(e) => setRoute(e.target.value as PayoutRoute)} aria-label="Freelancer payout">
            <option value="sepa">Freelancer payout: SEPA bank transfer</option>
            <option value="eurc">Freelancer payout: keep EURC</option>
          </select>
        )}
        <p className={styles.muted}>
          Demo rate: 1 ETH = {euro(EUR_PER_ETH)}. The bank, AML and FX providers are sandboxes. Your wallet signs the real escrow deposit.
          {!backendOnline && " The backend is offline, so the bank steps run as a local demo."}
        </p>
        <button className={styles.button} disabled={!valid} onClick={() => onSubmit({ freelancer, amountEth, days, description, route })}>
          {Number(amountEth) > 0 ? `Fund a Job (${euro(eur)})` : "Fund a Job"}
        </button>
      </aside>
    </div>
  );
}
