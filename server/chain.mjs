import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseEventLogs } from "viem";
import { db, save } from "./db.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const abi = JSON.parse(readFileSync(join(root, "abi/FreelanceEscrow.json"), "utf8")).abi;

export const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
export const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS ?? process.env.VITE_ESCROW_ADDRESS;

export const client = createPublicClient({ transport: http(RPC_URL) });

const MAX_RANGE = 2000n;

export async function txInfo(hash, blockNumber) {
  try {
    const [receipt, block] = await Promise.all([client.getTransactionReceipt({ hash }), client.getBlock({ blockNumber })]);
    return {
      source: "chain",
      contract: ESCROW_ADDRESS,
      txHash: hash,
      blockNumber: Number(blockNumber),
      gasUsed: Number(receipt.gasUsed),
      from: receipt.from,
      blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
    };
  } catch {
    return { contract: ESCROW_ADDRESS, txHash: hash, blockNumber: Number(blockNumber) };
  }
}

/**
 * Polls the escrow for new events and hands each one to `onEvent`. The cursor is persisted,
 * so events emitted while the server was down are picked up on the next start.
 */
export function watchEscrow(onEvent, intervalMs = 2000) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const latest = await client.getBlockNumber();
      if (db.cursor === null) {
        db.cursor = String(process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) - 1n : latest);
        save();
      }
      let from = BigInt(db.cursor) + 1n;
      while (from <= latest) {
        const to = from + MAX_RANGE - 1n < latest ? from + MAX_RANGE - 1n : latest;
        const logs = await client.getLogs({ address: ESCROW_ADDRESS, fromBlock: from, toBlock: to });
        for (const log of parseEventLogs({ abi, logs })) await onEvent(log);
        db.cursor = String(to);
        save();
        from = to + 1n;
      }
    } catch (e) {
      console.error("[chain] poll failed:", e.shortMessage ?? e.message);
    } finally {
      busy = false;
    }
  };
  const t = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(t);
}
