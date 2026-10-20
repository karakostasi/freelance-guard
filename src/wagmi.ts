import { createConfig, http } from "wagmi";
import { baseSepolia, hardhat, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import artifact from "../abi/FreelanceEscrow.json";

export const escrowAbi = artifact.abi;
export const escrowAddress = import.meta.env.VITE_ESCROW_ADDRESS as `0x${string}`;

// First block of the escrow contract. Event lookups start here; public RPCs cap log ranges.
export const escrowDeployBlock = import.meta.env.VITE_ESCROW_DEPLOY_BLOCK
  ? BigInt(import.meta.env.VITE_ESCROW_DEPLOY_BLOCK as string)
  : undefined;

export const config = createConfig({
  chains: [baseSepolia, hardhat, sepolia],
  connectors: [injected({ target: "metaMask" })],
  transports: {
    [baseSepolia.id]: http(),
    [hardhat.id]: http(),
    [sepolia.id]: http(),
  },
});
