import { useEffect, useState } from "react";

/** Current unix time in seconds, refreshed every `intervalMs`. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const t = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
