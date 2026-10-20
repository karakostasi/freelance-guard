import { useEffect, useState } from "react";

export type Route = { page: "jobs" | "flow"; jobId?: string };

const parse = (hash: string): Route => {
  const [, page, jobId] = hash.replace(/^#/, "").split("/");
  return page === "flow" ? { page: "flow", jobId: jobId || undefined } : { page: "jobs" };
};

export const navigate = (path: string) => {
  window.location.hash = path;
};

/** Minimal hash router: "#/" is the jobs page, "#/flow" or "#/flow/<jobId>" is the payment flow page. */
export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
