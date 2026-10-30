import type { PayoutRoute } from "./fiatFlow";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8787";

export type PaymentRun = {
  id: string;
  ref: string;
  payer: string;
  payee: string;
  amount: string;
  token: "eth" | "eurc" | "usdc";
  /** What the payer pays the bank in: dollars for USDC, euros for the rest. */
  currency: "EUR" | "USD";
  /** The bank transfer in that currency: the job plus the surcharge. */
  transferFiat: number;
  /** The job takes the yield, so there is no surcharge. */
  useYield: boolean;
  /** The job amount in euros. What the payee is owed, before the platform fee. */
  amountEur: number;
  /** What the payer pays on top of the amount, in the job's token, and the payee's fee. */
  surcharge: string;
  fee: string;
  /** What the bank transfer has to be: the job plus the surcharge. */
  transferEur: number;
  /** What the payee received after the fee, once the first milestone is paid. */
  payoutEur?: number;
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
  health: () => request<{ ok: boolean; eurPerEth: number; chainId?: number; realMoney?: boolean; bankRails?: boolean }>("/api/health"),
  createPayment: (body: { payer: string; payee: string; amount: string; token: "eth" | "eurc" | "usdc"; useYield?: boolean; milestones: { title: string; amount: string; days: string }[]; description: string }) =>
    post<{ run: PaymentRun; bank: { reference: string; amountEur: number; amount: number; currency: "EUR" | "USD" } }>("/api/payments", body),
  bankTransfer: (reference: string) => post<{ ok: boolean }>("/api/sandbox/bank-transfer", { reference }),
  markSigned: (id: string, gasMode: "sponsored" | "wallet") => post(`/api/payments/${id}/signed`, { gasMode }),
  cancel: (id: string, reason: string) => post(`/api/payments/${id}/cancel`, { reason }),
  runForJob: async (jobId: number) => {
    const res = await fetch(`${API_URL}/api/jobs/${jobId}/run`);
    return res.ok ? ((await res.json()) as PaymentRun) : null;
  },
};

export type EmailStatus = { email: string | null; verified: boolean };

/** The signed-in account's notification email. `token` comes from the wallet sign-in. */
export const emailApi = {
  get: (token: string) => request<EmailStatus>("/api/email", { headers: { authorization: `Bearer ${token}` } }),
  set: (token: string, email: string) => request<EmailStatus>("/api/email", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ email }) }),
  remove: (token: string) => request<EmailStatus>("/api/email", { method: "DELETE", headers: { authorization: `Bearer ${token}` } }),
};

/** What anyone may see of how a payee is paid: the way, and the last digits of the account. */
export type PayoutPublic = { route: "sepa" | "ach" | "eurc" | null; currency?: "EUR" | "USD"; last4?: string };

/** What the payee saved, in full. Only they can read it. */
export type PayoutChoice = { route: "sepa" | "ach" | "eurc" | null; holder?: string; iban?: string; routing?: string; account?: string };

const authed = (token: string, init?: RequestInit) => ({ ...init, headers: { authorization: `Bearer ${token}`, ...init?.headers } });

export const payoutApi = {
  /** How this address is paid. No sign-in needed, the account is not in it. */
  of: (address: string) => request<PayoutPublic>(`/api/payout/${address}`),
  get: (token: string) => request<PayoutChoice>("/api/payout", authed(token)),
  set: (token: string, choice: PayoutChoice) => request<PayoutChoice>("/api/payout", authed(token, { method: "PUT", body: JSON.stringify(choice) })),
  clear: (token: string) => request<PayoutChoice>("/api/payout", authed(token, { method: "DELETE" })),
};
