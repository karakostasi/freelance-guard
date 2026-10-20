import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { isAddress } from "viem";
import { EUR_PER_ETH } from "../lib/fiatFlow";
import { euro } from "../lib/jobs";
import type { FundingForm } from "../hooks/useFiatFunding";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

/** Side drawer with the "pay a milestone with euros" form. */
export function PayDrawer({ onClose, onSubmit }: { onClose: () => void; onSubmit: (form: FundingForm) => void }) {
  const [freelancer, setFreelancer] = useState("");
  const [amountEth, setAmountEth] = useState("");
  const [days, setDays] = useState("");
  const [description, setDescription] = useState("");

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
          <h3>Pay a milestone with euros</h3>
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
        <p className={styles.muted}>Demo rate: 1 ETH = {euro(EUR_PER_ETH)}. The bank steps are simulated. Your wallet signs the real escrow deposit.</p>
        <button className={styles.button} disabled={!valid} onClick={() => onSubmit({ freelancer, amountEth, days, description })}>
          {Number(amountEth) > 0 ? `Fund Milestone (${euro(eur)})` : "Fund Milestone"}
        </button>
      </aside>
    </div>
  );
}
