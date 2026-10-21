// The rules for sending funds from the wallet panel. No imports, so they can be unit-tested on their own.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Left in the wallet when sending "max" ETH, so there is something to pay the network fee with. */
export const ETH_GAS_BUFFER = 50_000_000_000_000n; // 0.00005 ETH

/** "1.5" as base units (1500000 for a 6-decimal token), or null if it isn't a plain positive amount in that precision. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const match = text.trim().match(/^(\d+)?(?:\.(\d+))?$/);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** The most that can be sent: all of a token, but for ETH keep a little for the network fee. */
export const maxSendable = (balance: bigint, isNative: boolean) => (isNative ? (balance > ETH_GAS_BUFFER ? balance - ETH_GAS_BUFFER : 0n) : balance);

export type SendCheck = { units: bigint; error: string | null };

/** Checks a send before the wallet is asked, so a typo is caught here instead of costing money. */
export function checkSend(input: { to: string; from: string; amountText: string; decimals: number; symbol: string; balance: bigint | undefined; isNative: boolean }): SendCheck {
  const units = parseAmount(input.amountText, input.decimals) ?? 0n;
  const fail = (error: string): SendCheck => ({ units, error });
  if (!input.to.trim()) return fail("Enter the address to send to.");
  if (!ADDRESS.test(input.to.trim())) return fail("That doesn't look like a wallet address (0x followed by 40 characters).");
  if (input.to.trim().toLowerCase() === input.from.toLowerCase()) return fail("That's your own address.");
  if (!input.amountText.trim()) return fail("Enter an amount.");
  if (parseAmount(input.amountText, input.decimals) === null) return fail(`Enter a plain amount with at most ${input.decimals} decimals.`);
  if (units === 0n) return fail("The amount must be more than zero.");
  if (input.balance === undefined) return fail("Loading your balance…");
  if (units > input.balance) return fail(`That is more ${input.symbol} than you have.`);
  if (input.isNative && units > maxSendable(input.balance, true)) return fail("Leave a little ETH to pay the network fee.");
  return { units, error: null };
}
