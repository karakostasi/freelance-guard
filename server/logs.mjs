// Reading escrow events in pieces. Public RPCs refuse long block ranges (Base Sepolia's allows 200), and say so in
// their own words, so a refused range makes the next one shorter.

/** How many blocks to ask for at first. */
export const START_RANGE = 2000n;

const REFUSED = /\brange\b|response size|more than [\d,]+ results|too many (blocks|results)/i;
const NOT_THAT = /rate.?limit|too many requests|\b429\b/i;

/** The RPC refused the range as too wide, as opposed to failing for another reason. */
export const rangeRefused = (e) => {
  const text = `${e?.shortMessage ?? ""} ${e?.details ?? ""} ${e?.message ?? ""}`;
  return REFUSED.test(text) && !NOT_THAT.test(text);
};

/** The size the RPC says it allows ("limited to a 200 range", "up to a 10 block range"), when it says one. */
const allowed = (e) => {
  const text = `${e?.details ?? ""} ${e?.shortMessage ?? ""} ${e?.message ?? ""}`;
  const found = /(\d[\d,]*)\s*(?:-?block\s*)?range|up to (?:a )?(\d[\d,]*)\s*block/i.exec(text);
  const n = Number((found?.[1] ?? found?.[2] ?? "").replace(/,/g, ""));
  return n > 0 ? BigInt(n) : 0n;
};

/**
 * The logs from `from` on, for as many blocks as the RPC allows, and the last block they cover. `state.range` is how
 * wide to ask. It shrinks when a range is refused and stays that way, so only the first call pays for finding out.
 */
export async function logsFrom(getLogs, from, latest, state = { range: START_RANGE }) {
  for (;;) {
    const to = from + state.range - 1n < latest ? from + state.range - 1n : latest;
    try {
      return { logs: await getLogs(from, to), to };
    } catch (e) {
      if (state.range <= 1n || !rangeRefused(e)) throw e;
      const limit = allowed(e);
      state.range = limit > 0n && limit < state.range ? limit : state.range / 2n;
    }
  }
}
