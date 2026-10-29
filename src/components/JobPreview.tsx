import { Check, CreditCard, Landmark, Lock } from "lucide-react";
import p from "./JobPreview.module.css";

type State = "paid" | "review" | "locked";

// An illustration of a job, not real data.
const ROWS: { title: string; amount: string; state: State; label: string }[] = [
  { title: "Upfront", amount: "€600", state: "paid", label: "Paid" },
  { title: "Draft", amount: "€800", state: "review", label: "In review" },
  { title: "Delivery", amount: "€600", state: "locked", label: "Locked" },
];

/** A small picture of what the app is: a job paid in stages, held in escrow, with the money's way in and out around it. */
export function JobPreview() {
  return (
    <div className={p.stage} aria-hidden="true">
      <div className={p.card}>
        <div className={p.head}>
          <span className={p.avatar} />
          <span className={p.name}>
            <strong>Website redesign</strong>
            <span>Job #12</span>
          </span>
          <span className={p.escrow}>
            <Lock size={12} /> In escrow
          </span>
        </div>
        <div className={p.total}>€2,000</div>
        <ul className={p.rows}>
          {ROWS.map((r) => (
            <li key={r.title} className={`${p.row} ${p[r.state]}`}>
              <span className={p.mark}>{r.state === "paid" ? <Check size={13} /> : r.state === "locked" ? <Lock size={12} /> : <span className={p.pulse} />}</span>
              <span className={p.rowTitle}>{r.title}</span>
              <span className={p.amount}>{r.amount}</span>
              <span className={p.badge}>{r.label}</span>
            </li>
          ))}
        </ul>
        <div className={p.bar}>
          <span className={p.fill} />
        </div>
      </div>
      <span className={`${p.chip} ${p.chipA}`}>
        <CreditCard size={14} /> Paid by card
      </span>
      <span className={`${p.chip} ${p.chipB}`}>
        <Landmark size={14} /> Paid out to the bank
      </span>
    </div>
  );
}
