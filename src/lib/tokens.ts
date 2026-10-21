import { formatUnits, zeroAddress } from "viem";
import type { Job } from "./jobs";
import { EUR_PER_ETH } from "./fiatFlow";

export type Token = {
  symbol: string;
  decimals: number;
  /** Undefined for the chain's native coin (ETH). */
  address?: `0x${string}`;
  /** Demo conversion rate to euros, used only to show an approximate euro value. */
  eurPer: number;
};

export const ETH: Token = { symbol: "ETH", decimals: 18, eurPer: EUR_PER_ETH };

// Base Sepolia test tokens from Circle. Override with env vars (e.g. a local mock token).
export const EURC: Token = {
  symbol: "EURC",
  decimals: 6,
  address: ((import.meta.env.VITE_EURC_ADDRESS as string | undefined) || "0x808456652fdb597867f38412077A9182bf77359F") as `0x${string}`,
  eurPer: 1,
};

export const USDC: Token = {
  symbol: "USDC",
  decimals: 6,
  address: ((import.meta.env.VITE_USDC_ADDRESS as string | undefined) || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,
  eurPer: 0.92,
};

export const TOKENS: Token[] = [ETH, EURC, USDC];

/** Which token a job is paid in. */
export function tokenOf(job: Job): Token {
  const address = job.token;
  if (!address || address === zeroAddress) return ETH;
  return TOKENS.find((t) => t.address?.toLowerCase() === address.toLowerCase()) ?? { symbol: "TOKEN", decimals: 18, address: address as `0x${string}`, eurPer: 0 };
}

export const formatUnitsOf = (token: Token, units: bigint) => `${formatUnits(units, token.decimals)} ${token.symbol}`;

/** An amount in the job's token, e.g. "500 EURC". */
export const formatAmount = (job: Job, units: bigint) => formatUnitsOf(tokenOf(job), units);

export const toEur = (token: Token, units: bigint) => Number(formatUnits(units, token.decimals)) * token.eurPer;
