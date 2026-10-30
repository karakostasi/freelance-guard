import type { Config } from "@coinbase/cdp-core";

/**
 * The Coinbase Developer Platform project that gives people an email login and a wallet made for them. Without its
 * project id (VITE_CDP_PROJECT_ID) only a browser wallet such as MetaMask can sign in.
 */
const projectId = import.meta.env.VITE_CDP_PROJECT_ID as string | undefined;

// A smart account is made at login. On Base Sepolia its gas is sponsored by default, so it needs no ETH. On Base mainnet a
// paymaster has to be set up in the CDP Portal for that.
export const cdpConfig: Config | null = projectId ? { projectId, ethereum: { createOnLogin: "smart" } } : null;
