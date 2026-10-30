import { base, baseSepolia } from "wagmi/chains";

/**
 * The network this build of the app is for, from VITE_CHAIN: "base-sepolia" (the default, play money) or "base" (real
 * money). Everything that depends on the network (the chain, the explorer, the token addresses, how a balance is shown,
 * what the page says about test funds) comes from here, so a build is for one network and can't be half of each.
 * Anything else is refused, so a typo can't quietly leave a build on the test network.
 */
const CHAINS = { "base-sepolia": baseSepolia, base } as const;
type ChainKey = keyof typeof CHAINS;

const wanted = (import.meta.env.VITE_CHAIN as string | undefined)?.trim() || "base-sepolia";
if (!(wanted in CHAINS)) throw new Error(`VITE_CHAIN must be "base-sepolia" or "base", not "${wanted}".`);

export const chain = CHAINS[wanted as ChainKey];
/** Real money. */
export const isMainnet = wanted === "base";

const explorerBase = chain.blockExplorers.default.url.replace(/\/+$/, "");
export const explorerTx = (hash: string) => `${explorerBase}/tx/${hash}`;
export const explorerAddress = (address: string) => `${explorerBase}/address/${address}`;
export const explorerHost = explorerBase;

/** The network as people read it, e.g. on a receipt. */
export const networkLabel = isMainnet ? "Base" : "Base Sepolia (test network)";

/**
 * Circle's own tokens on each network. On Base mainnet these are fixed here, and VITE_USDC_ADDRESS and VITE_EURC_ADDRESS
 * are ignored, so a setting can't send money to a token that only looks like USDC. On the test network they can be
 * overridden, for a mock token.
 */
export const TOKEN_ADDRESSES = {
  USDC: isMainnet ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : ((import.meta.env.VITE_USDC_ADDRESS as string | undefined) || "0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
  EURC: isMainnet ? "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" : ((import.meta.env.VITE_EURC_ADDRESS as string | undefined) || "0x808456652fdb597867f38412077A9182bf77359F"),
} as { USDC: `0x${string}`; EURC: `0x${string}` };
