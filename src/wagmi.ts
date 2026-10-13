import { createConfig, http } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import artifact from "../artifacts/contracts/FreelanceEscrow.sol/FreelanceEscrow.json";

export const escrowAbi = artifact.abi;
export const escrowAddress = import.meta.env.VITE_ESCROW_ADDRESS as `0x${string}`;

export const config = createConfig({
  chains: [hardhat, sepolia],
  connectors: [injected()],
  transports: {
    [hardhat.id]: http(),
    [sepolia.id]: http(),
  },
});
