import { useEffect, useState } from "react";

export type Route = { page: "home" | "jobs" | "flow"; jobId?: string };

const parse = (hash: string): Route => {
  const [, page, jobId] = hash.replace(/^#/, "").split("/");
  if (page === "flow") return { page: "flow", jobId: jobId || undefined };
  return page === "jobs" ? { page: "jobs" } : { page: "home" };
};

export const navigate = (path: string) => {
  window.location.hash = path;
};

/** Minimal hash router: "#/" is the landing page, "#/jobs" the jobs page, "#/flow[/<jobId>]" the payment flow page. */
export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
