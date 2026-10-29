import { createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { client, RPC_URL } from "./chain.mjs";

const ABI = parseAbi(["function mint(address to, uint256 amount)"]);

/**
 * The sandbox's stand-in for an on-ramp that delivers the stablecoin: it mints the payer a test token of the same
 * amount. That only works for our own mock tokens, which anyone can mint. Circle's test tokens have no public mint, so
 * for those the payer has to hold the token already, and the attempt just reports that it could not.
 *
 * The key can mint any mock token, so it is only ever used on test networks: local Hardhat, Base Sepolia and Sepolia.
 */
export const MINT_CHAINS = new Set([31337, 84532, 11155111]);

// One mint at a time, so two payments can't pick the same transaction number.
let queue = Promise.resolve();

export function mintTo({ token, to, units }) {
  const run = queue.then(() => mint({ token, to, units }));
  queue = run.catch(() => {});
  return run;
}

async function mint({ token, to, units }) {
  const key = process.env.MINT_PRIVATE_KEY;
  if (!key) return { minted: false, reason: "MINT_PRIVATE_KEY is not set, so the payer has to hold the token already." };
  const chainId = await client.getChainId();
  if (!MINT_CHAINS.has(chainId)) return { minted: false, reason: `Minting is only allowed on test networks, and this is chain ${chainId}.` };
  try {
    const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
    const chain = defineChain({ id: chainId, name: "test network", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
    const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
    const txHash = await wallet.writeContract({ address: token, abi: ABI, functionName: "mint", args: [to, units] });
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return { minted: false, reason: "The mint transaction failed." };
    return { minted: true, txHash };
  } catch (e) {
    return { minted: false, reason: `This token can't be minted by us (${(e.shortMessage ?? e.message).split("\n")[0]}), so the payer has to hold it already.` };
  }
}
