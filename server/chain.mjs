import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseEventLogs } from "viem";
import { db, save } from "./db.mjs";
import { START_RANGE, logsFrom } from "./logs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const abi = JSON.parse(readFileSync(join(root, "abi/FreelanceEscrow.json"), "utf8")).abi;

export const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
export const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS ?? process.env.VITE_ESCROW_ADDRESS;

export const client = createPublicClient({ transport: http(RPC_URL) });

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
  // How many blocks one request may cover. The RPC decides, and the answer is kept between polls.
  const reach = { range: START_RANGE };
  let catchingUp = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const latest = await client.getBlockNumber();
      // A new contract means a new event history: start over instead of scanning from the old one.
      if (db.cursorContract?.toLowerCase() !== ESCROW_ADDRESS.toLowerCase()) {
        db.cursor = null;
        db.cursorContract = ESCROW_ADDRESS;
      }
      if (db.cursor === null) {
        db.cursor = String(process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) - 1n : latest);
        save();
      }
      let from = BigInt(db.cursor) + 1n;
      // After a long stop there is a lot to read, and a public RPC only allows a little at a time. New jobs are only seen once it is done.
      if (latest - from > 5000n && !catchingUp) {
        catchingUp = true;
        console.log(`[chain] ${latest - from} blocks behind, catching up. This can take a few minutes on a public RPC.`);
      }
      while (from <= latest) {
        const { logs, to } = await logsFrom((fromBlock, toBlock) => client.getLogs({ address: ESCROW_ADDRESS, fromBlock, toBlock }), from, latest, reach);
        for (const log of parseEventLogs({ abi, logs })) await onEvent(log);
        db.cursor = String(to);
        save();
        from = to + 1n;
      }
      if (catchingUp) {
        catchingUp = false;
        console.log("[chain] caught up");
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
