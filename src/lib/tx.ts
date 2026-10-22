import { encodeFunctionData, type Abi } from "viem";
import { getCapabilities, getChainId, sendCalls, sendTransaction, waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";
import { config } from "../wagmi";
import { firstLine, userRejected } from "./errors";

export type Call = { to: `0x${string}`; data?: `0x${string}`; value?: bigint };

const PAYMASTER_URL = (import.meta.env.VITE_PAYMASTER_URL as string | undefined) || undefined;

/** A contract call, ready to be sent on its own or batched with others. */
export const callOf = (c: { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }): Call => ({
  to: c.address,
  data: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args }),
  value: c.value,
});

/** Can this wallet have its gas paid by our paymaster on the current network? */
async function canSponsor(account: `0x${string}`) {
  if (!PAYMASTER_URL) return false;
  try {
    const chainId = await getChainId(config);
    const caps = (await getCapabilities(config, { account })) as Record<number, { paymasterService?: { supported?: boolean } } | undefined>;
    return !!caps[chainId]?.paymasterService?.supported;
  } catch {
    return false; // this wallet doesn't expose capabilities (a plain MetaMask, for example)
  }
}

export type Sent = { hash: `0x${string}`; sponsored: boolean };

/**
 * Sends one or more calls and waits for them to confirm, returning the last transaction hash.
 *
 * With a paymaster configured and a wallet that supports it (the passkey wallet does), all the calls go in a
 * single confirmation and the user pays no gas. Anything else is sent as ordinary transactions, one after the
 * other, exactly as before. `onSubmitted` fires as soon as the wallet has accepted the request.
 */
export async function sendTransactions(account: `0x${string}`, calls: Call[], onSubmitted?: (sponsored: boolean) => void): Promise<Sent> {
  let sponsorFailure = "";
  if (await canSponsor(account)) {
    try {
      const { id } = await sendCalls(config, { calls, capabilities: { paymasterService: { url: PAYMASTER_URL! } } });
      onSubmitted?.(true);
      const status = await waitForCallsStatus(config, { id });
      if (status.status === "failure") throw new Error("The transaction failed on-chain.");
      const hash = status.receipts?.at(-1)?.transactionHash;
      if (!hash) throw new Error("The wallet did not report a transaction.");
      return { hash, sponsored: true };
    } catch (e) {
      if (userRejected(e)) throw e;
      sponsorFailure = firstLine(e); // fall back to an ordinary transaction
    }
  }

  try {
    let hash: `0x${string}` | undefined;
    for (const [i, call] of calls.entries()) {
      hash = await sendTransaction(config, call);
      if (i === 0) onSubmitted?.(false);
      if (i < calls.length - 1) await waitForTransactionReceipt(config, { hash });
    }
    return { hash: hash!, sponsored: false };
  } catch (e) {
    if (userRejected(e) || !sponsorFailure) throw e;
    throw new Error(`${firstLine(e)} (the free-gas attempt failed first: ${sponsorFailure})`);
  }
}
