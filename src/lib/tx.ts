import { encodeFunctionData, erc20Abi, type Abi } from "viem";
import { getAccount, readContract, sendCalls, sendTransaction, waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";
import { CDP_CONNECTOR_ID } from "@coinbase/cdp-wagmi";
import { config, escrowAddress } from "../wagmi";

export type Call = { to: `0x${string}`; data?: `0x${string}`; value?: bigint };

/** A call to a contract function, ready to be sent. */
export const contractCall = (c: { address: `0x${string}`; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint }): Call => ({
  to: c.address,
  data: encodeFunctionData({ abi: c.abi as Abi, functionName: c.functionName, args: c.args }),
  value: c.value,
});

/** The call that lets the escrow pull `amount` of `token` from `owner`, or null when it already may. */
export async function approvalCall(token: `0x${string}`, owner: `0x${string}`, amount: bigint): Promise<Call | null> {
  const allowance = await readContract(config, { address: token, abi: erc20Abi, functionName: "allowance", args: [owner, escrowAddress] });
  return allowance >= amount ? null : contractCall({ address: token, abi: erc20Abi, functionName: "approve", args: [escrowAddress, amount] });
}

/** The wallet made at an email login is a smart account: it sends calls as one batch and has no ETH for gas. */
const isSmartWallet = () => getAccount(config).connector?.id === CDP_CONNECTOR_ID;

/**
 * Sends calls from the connected wallet and returns the hash of the transaction that carried them.
 *
 * A smart account (the wallet made at an email login) sends them as one atomic batch, with one confirmation, and its gas
 * is sponsored (on Base Sepolia by default), so the person needs no ETH. Any other wallet signs them one by one and pays
 * its own gas.
 *
 * `onSend` runs just before the wallet is asked, with how the gas is paid. `onStep` runs before each prompt, with that
 * call's label (the calls and their labels line up).
 */
export async function sendWalletCalls(calls: Call[], opts: { labels?: string[]; onSend?: (gas: "sponsored" | "wallet") => void | Promise<void>; onStep?: (label: string) => void } = {}): Promise<`0x${string}`> {
  if (isSmartWallet()) {
    await opts.onSend?.("sponsored");
    opts.onStep?.(opts.labels?.at(-1) ?? "Confirm in your wallet…");
    const { id } = await sendCalls(config, { calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value })) });
    const done = await waitForCallsStatus(config, { id });
    const hash = done.receipts?.[0]?.transactionHash;
    if (done.status !== "success" || !hash) throw new Error("The transaction failed on-chain.");
    return hash;
  }

  await opts.onSend?.("wallet");
  let hash: `0x${string}` | undefined;
  for (const [i, call] of calls.entries()) {
    opts.onStep?.(opts.labels?.[i] ?? "Confirm in your wallet…");
    hash = await sendTransaction(config, { to: call.to, data: call.data, value: call.value });
    if (i < calls.length - 1) await waitForTransactionReceipt(config, { hash });
  }
  return hash!;
}
