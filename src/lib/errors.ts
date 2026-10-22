// Reading wallet errors. No imports, so it can be unit-tested on its own.

/** True if the person closed or refused the wallet's confirmation (EIP-1193 code 4001), as opposed to a real failure. */
export function userRejected(error: unknown): boolean {
  for (let err = error as { name?: string; code?: number; cause?: unknown } | undefined, depth = 0; err && depth < 8; err = err.cause as typeof err, depth++) {
    if (err.code === 4001 || err.name === "UserRejectedRequestError") return true;
  }
  return false;
}

/** The first line of an error message, which is the useful part of most wallet and RPC errors. */
export const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0];
