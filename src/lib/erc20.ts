import { erc20Abi, type Abi } from "viem";
import { readContract } from "wagmi/actions";
import { config, escrowAddress } from "../wagmi";
import { callOf, type Call } from "./tx";

/** The approval the escrow needs before it can pull `amount` of `token` from `owner`, or null if that is already allowed. */
export async function approvalCall(token: `0x${string}`, owner: `0x${string}`, amount: bigint): Promise<Call | null> {
  const allowance = await readContract(config, { address: token, abi: erc20Abi, functionName: "allowance", args: [owner, escrowAddress] });
  if (allowance >= amount) return null;
  return callOf({ address: token, abi: erc20Abi as Abi, functionName: "approve", args: [escrowAddress, amount] });
}
