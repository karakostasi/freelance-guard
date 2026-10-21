import { erc20Abi } from "viem";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { config, escrowAddress } from "../wagmi";

/** Makes sure the escrow may pull `amount` of `token` from `owner`, asking for an approval only if needed. */
export async function ensureAllowance(token: `0x${string}`, owner: `0x${string}`, amount: bigint, onApprove?: () => void) {
  const allowance = await readContract(config, { address: token, abi: erc20Abi, functionName: "allowance", args: [owner, escrowAddress] });
  if (allowance >= amount) return;
  onApprove?.();
  const hash = await writeContract(config, { address: token, abi: erc20Abi, functionName: "approve", args: [escrowAddress, amount] });
  await waitForTransactionReceipt(config, { hash });
}
