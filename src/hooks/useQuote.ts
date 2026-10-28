import { useReadContract } from "wagmi";
import { zeroAddress } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import type { Token } from "../lib/tokens";

/** What the escrow says is wrong with a job it can't price, in words, or null when there is nothing wrong. */
const problemWith = (message: string | undefined) => {
  if (!message) return null;
  if (message.includes("JobTooSmall")) return "This is below the smallest job the escrow accepts.";
  if (message.includes("TokenNotAllowed")) return "The escrow doesn't accept this asset.";
  if (message.includes("NoYield")) return "This asset has no yield.";
  return "Couldn't work out the fee. Check the connection and try again.";
};

/**
 * What a job with these milestone amounts costs, read from the escrow so the rules live in one place: the fee the payee
 * pays out of the payments, and the surcharge the payer pays on top (none when the job takes the yield).
 */
export function useQuote(token: Token, amounts: bigint[], useYield: boolean, enabled: boolean) {
  const { data, error } = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "quote",
    args: [token.address ?? zeroAddress, amounts, useYield],
    query: { enabled, retry: false },
  });
  const quote = data as readonly [bigint, bigint, bigint] | undefined;
  return { fee: quote?.[1], surcharge: quote?.[2], problem: enabled ? problemWith(error?.message) : null };
}

export type TokenConfig = { enabled: boolean; surchargeBps: number; minFee: bigint; minJob: bigint; vault: string };

/** The escrow's rules for one asset: whether it is accepted, its minimums, and the vault that earns yield on it. */
export function useTokenConfig(token: Token): TokenConfig | undefined {
  const { data } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "tokenConfig", args: [token.address ?? zeroAddress] });
  const cfg = data as readonly [boolean, number, bigint, bigint, string] | undefined;
  return cfg && { enabled: cfg[0], surchargeBps: Number(cfg[1]), minFee: cfg[2], minJob: cfg[3], vault: cfg[4] };
}
