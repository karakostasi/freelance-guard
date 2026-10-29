import { createConfig, http } from "wagmi";
import { baseSepolia, hardhat } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { createCDPEmbeddedWalletConnector } from "@coinbase/cdp-wagmi";
import { cdpConfig } from "./cdp";
import artifact from "../abi/FreelanceEscrow.json";

export const escrowAbi = artifact.abi;
export const escrowAddress = import.meta.env.VITE_ESCROW_ADDRESS as `0x${string}`;

// First block of the escrow contract. Event lookups start here; public RPCs cap log ranges.
export const escrowDeployBlock = import.meta.env.VITE_ESCROW_DEPLOY_BLOCK
  ? BigInt(import.meta.env.VITE_ESCROW_DEPLOY_BLOCK as string)
  : undefined;

// A local Hardhat chain is only offered when asked for (VITE_LOCAL_CHAIN=1). The embedded wallet only knows real networks.
const local = import.meta.env.VITE_LOCAL_CHAIN === "1";

const rpc = (import.meta.env.VITE_BASE_SEPOLIA_RPC_URL as string | undefined) || undefined;

export const config = createConfig({
  chains: local ? ([baseSepolia, hardhat] as const) : ([baseSepolia] as const),
  connectors: [
    // An email login and a wallet made for the person, for people with no crypto wallet. MetaMask is for those who have one.
    ...(cdpConfig ? [createCDPEmbeddedWalletConnector({ cdpConfig, providerConfig: { chains: [baseSepolia], transports: { [baseSepolia.id]: http(rpc) } } })] : []),
    injected({ target: "metaMask" }),
  ],
  transports: {
    // The public RPC is shared and rate-limited. Set VITE_BASE_SEPOLIA_RPC_URL to your own (Alchemy, Infura, QuickNode...).
    [baseSepolia.id]: http(rpc),
    [hardhat.id]: http(),
  },
});
