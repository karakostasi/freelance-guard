import { useReputation } from "../hooks/useReputation";
import { MIN_HISTORY, TIER_LABEL, type SideRecord } from "../lib/reputation";
import styles from "../App.module.css";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function facts(role: "payer" | "payee", r: SideRecord) {
  if (r.jobs === 0) return `No jobs as ${role} yet`;
  const parts = [`${plural(r.paid, "milestone")} paid`];
  if (role === "payee" && r.missed > 0) parts.push(`${plural(r.missed, "missed deadline")}`);
  if (r.disputes > 0) parts.push(`${plural(r.disputes, "dispute")}${r.disputesLost > 0 ? `, ${r.disputesLost} lost` : ""}`);
  return parts.join(" · ");
}

const explain = (role: "payer" | "payee") =>
  role === "payer"
    ? `Based on this account's jobs as a payer. It counts a dispute the payer lost (the payee was paid anyway) as a bad sign. A record needs ${MIN_HISTORY} finished milestones before it is rated.`
    : `Based on this account's jobs as a payee. It counts missed deadlines and disputes lost as bad signs. A record needs ${MIN_HISTORY} finished milestones before it is rated.`;

/** A small badge and a line of facts about how an account has behaved on the escrow, as a payer or as a payee. */
export function ReputationBadge({ address, role }: { address: string; role: "payer" | "payee" }) {
  const { reputation, isLoading, approximate } = useReputation(address);
  if (isLoading || !reputation) return <span className={styles.muted}>Checking record…</span>;
  const record = role === "payer" ? reputation.asPayer : reputation.asPayee;
  return (
    <span className={styles.reputation} title={explain(role) + (approximate ? " Dispute history could not be fully read, so older disputes may be missing." : "")}>
      <span className={`${styles.badge} ${styles[`tier_${record.tier}`]}`}>{TIER_LABEL[record.tier]}</span>
      <span className={styles.muted}>
        {facts(role, record)}
        {approximate && record.jobs > 0 ? " (partial)" : ""}
      </span>
    </span>
  );
}
