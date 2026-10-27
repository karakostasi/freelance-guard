import { useEffect, useState } from "react";

export type Route = { page: "home" | "jobs" | "flow" | "receipt"; jobId?: string; milestone?: string };

const parse = (hash: string): Route => {
  const [, page, jobId, milestone] = hash.replace(/^#/, "").split("/");
  if (page === "flow") return { page: "flow", jobId: jobId || undefined };
  if (page === "receipt") return { page: "receipt", jobId: jobId || undefined, milestone: milestone || undefined };
  return page === "jobs" ? { page: "jobs" } : { page: "home" };
};

export const navigate = (path: string) => {
  window.location.hash = path;
};

/** Minimal hash router: "#/" is the landing page, "#/jobs" the jobs page, "#/flow[/<jobId>]" the payment flow page, "#/receipt/<jobId>/<milestone>" a receipt. */
export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
