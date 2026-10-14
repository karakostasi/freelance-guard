import styles from "../App.module.css";

export type Job = readonly [string, string, bigint, bigint, bigint, number, string, string];

export const STATUS = ["None", "Funded", "Submitted", "Disputed", "Paid", "Refunded"];

export const STATUS_CLASS = ["", styles.funded, styles.submitted, styles.disputed, styles.paid, styles.refunded];

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
