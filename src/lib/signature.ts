import { isAddressEqual, serializeErc6492Signature } from "viem";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { getCurrentUserSync } from "@coinbase/cdp-core";
import { CDP_CONNECTOR_ID } from "@coinbase/cdp-wagmi";
import { getAccount, getPublicClient, signMessage } from "wagmi/actions";
import { config } from "../wagmi";

/**
 * Signs `message` with the connected wallet, in a form the backend can check.
 *
 * The wallet made at an email login is a smart account, and it only exists on-chain once it sends its first transaction.
 * Until then nothing at its address can vouch for a signature, so the backend would refuse it. ERC-6492 fixes that: the
 * signature carries the recipe to create the account (the factory call), and the backend's check creates it in a
 * simulation before asking it. The same signature stays valid, plain, once the account is deployed.
 */
export async function signForBackend(address: `0x${string}`, message: string): Promise<`0x${string}`> {
  const signature = await signMessage(config, { message });
  if (getAccount(config).connector?.id !== CDP_CONNECTOR_ID) return signature;

  const client = getPublicClient(config);
  const owner = getCurrentUserSync()?.evmAccounts?.[0];
  if (!client || !owner || (await client.getCode({ address }))) return signature;

  // Only wrap when the recipe really leads to this address, otherwise it would prove nothing. There are two versions of
  // the factory, and the address says which one made the account.
  for (const version of ["1", "1.1"] as const) {
    const account = await toCoinbaseSmartAccount({ client, owners: [owner], version });
    if (!isAddressEqual(await account.getAddress(), address)) continue;
    const { factory, factoryData } = await account.getFactoryArgs();
    if (factory && factoryData) return serializeErc6492Signature({ address: factory, data: factoryData, signature });
  }
  console.warn(`The smart account ${address} is not one made from its owner ${owner}; sending the signature as it is.`);
  return signature;
}
