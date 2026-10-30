import { formatUnits, zeroAddress } from "viem";
import type { Job } from "./jobs";
import { EUR_PER_ETH } from "./fiatFlow";
import { TOKEN_ADDRESSES, isMainnet } from "../chain";

export type Token = {
  symbol: string;
  decimals: number;
  /** Undefined for the chain's native coin (ETH). */
  address?: `0x${string}`;
  /** Demo conversion rate to euros, used only to show an approximate euro value. */
  eurPer: number;
};

// A euro value is only shown where there is a rate. The rates here are invented (for the test network), so on the real one only
// EURC, which is a euro, has one.
export const ETH: Token = { symbol: "ETH", decimals: 18, eurPer: isMainnet ? 0 : EUR_PER_ETH };

// Circle's tokens on the network of this build (src/chain.ts says which, and which address).
export const EURC: Token = { symbol: "EURC", decimals: 6, address: TOKEN_ADDRESSES.EURC, eurPer: 1 };

export const USDC: Token = { symbol: "USDC", decimals: 6, address: TOKEN_ADDRESSES.USDC, eurPer: isMainnet ? 0 : 0.92 };

/** What a job can be paid in. ETH only on the test network: its euro value is invented, and the escrow's limits for it are set in euros. */
export const TOKENS: Token[] = isMainnet ? [EURC, USDC] : [ETH, EURC, USDC];

/** Which token a job is paid in. */
export function tokenOf(job: Job): Token {
  const address = job.token;
  if (!address || address === zeroAddress) return ETH;
  return TOKENS.find((t) => t.address?.toLowerCase() === address.toLowerCase()) ?? { symbol: "TOKEN", decimals: 18, address: address as `0x${string}`, eurPer: 0 };
}

export const formatUnitsOf = (token: Token, units: bigint) => `${formatUnits(units, token.decimals)} ${token.symbol}`;

/** An amount in the job's token, e.g. "500 EURC". */
export const formatAmount = (job: Job, units: bigint) => formatUnitsOf(tokenOf(job), units);

export { formatBalance } from "./format";

export const toEur = (token: Token, units: bigint) => Number(formatUnits(units, token.decimals)) * token.eurPer;
