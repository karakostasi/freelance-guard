import { useAccount, useBalance, useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import { ETH, EURC, USDC, type Token } from "../lib/tokens";

export type Asset = { token: Token; units: bigint };

const TOKENS = [EURC, USDC];

/** What the connected wallet holds of ETH, EURC and USDC. Refreshes by itself every 15 seconds. */
export function useWalletAssets() {
  const { address } = useAccount();
  const { data: native } = useBalance({ address, query: { refetchInterval: 15_000 } });
  const { data: reads } = useReadContracts({
    contracts: TOKENS.map((token) => ({ address: token.address!, abi: erc20Abi, functionName: "balanceOf" as const, args: [address!] as const })),
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  // A token that can't be read on this network (no contract at that address) is left out rather than shown as zero.
  const assets: Asset[] = [{ token: ETH, units: native?.value ?? 0n }];
  TOKENS.forEach((token, i) => {
    const read = reads?.[i];
    if (read?.status === "success") assets.push({ token, units: read.result as bigint });
  });
  return { assets, loaded: native !== undefined };
}
