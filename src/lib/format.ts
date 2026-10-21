// Number formatting with no imports, so it can be unit-tested on its own.

/** A balance for display: up to 6 decimals, no trailing zeros ("0.0123" rather than 0.012300000000000000). */
export function formatBalance(units: bigint, decimals: number) {
  const digits = units.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals).slice(0, 6).replace(/0+$/, "") : "";
  if (units > 0n && whole === "0" && fraction === "") return "< 0.000001";
  return fraction ? `${whole}.${fraction}` : whole;
}
