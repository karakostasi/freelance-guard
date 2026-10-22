// Number formatting with no imports, so it can be unit-tested on its own.

/** A balance for display: up to 6 decimals, no trailing zeros ("0.0123" rather than 0.012300000000000000). */
export function formatBalance(units: bigint, decimals: number) {
  const digits = units.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals).slice(0, 6).replace(/0+$/, "") : "";
  if (units > 0n && whole === "0" && fraction === "") return "< 0.000001";
  return fraction ? `${whole}.${fraction}` : whole;
}

export const formatDuration = (seconds: bigint) => {
  const s = Number(seconds > 0n ? seconds : 0n);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};
