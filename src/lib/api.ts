import type { PayoutRoute } from "./fiatFlow";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8787";

export type PaymentRun = {
  id: string;
  ref: string;
  payer: string;
  freelancer: string;
  amount: string;
  token: "eth" | "eurc";
  amountEur: number;
  route: PayoutRoute;
  status: string;
  jobId: number | null;
};

export type ServerEvent = {
  seq: number;
  at: number;
  type: "start" | "step_start" | "step_done" | "action_required" | "error" | "done";
  stage?: string;
  step?: string;
  payload?: Record<string, unknown>;
  message?: string;
  tx?: { to: `0x${string}`; data: `0x${string}`; value: string };
  /** Token approval to sign before `tx` (token jobs only). */
  approval?: { to: `0x${string}`; data: `0x${string}` };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  health: () => request<{ ok: boolean; eurPerEth: number }>("/api/health"),
  createPayment: (body: { payer: string; freelancer: string; amount: string; token: "eth" | "eurc"; milestones: { title: string; amount: string; days: string }[]; description: string; route: PayoutRoute }) =>
    post<{ run: PaymentRun; bank: { reference: string; amountEur: number } }>("/api/payments", body),
  bankTransfer: (reference: string) => post<{ ok: boolean }>("/api/sandbox/bank-transfer", { reference }),
  markSigned: (id: string, gasMode: "sponsored" | "wallet") => post(`/api/payments/${id}/signed`, { gasMode }),
  cancel: (id: string, reason: string) => post(`/api/payments/${id}/cancel`, { reason }),
  runForJob: async (jobId: number) => {
    const res = await fetch(`${API_URL}/api/jobs/${jobId}/run`);
    return res.ok ? ((await res.json()) as PaymentRun) : null;
  },
};
