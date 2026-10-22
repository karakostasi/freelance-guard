/**
 * Sends an email through Resend (https://resend.com) when RESEND_API_KEY is set, and otherwise just logs it,
 * so the whole flow can be tried locally without sending anything.
 * Note: Resend's default sender (onboarding@resend.dev) can only deliver to the account owner. Verify a
 * domain there and set MAIL_FROM to use it for everyone.
 */
export async function sendMail({ to, subject, text }, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail] (not sent, no RESEND_API_KEY) to ${to}: ${subject}`);
    return { sent: false };
  }
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM || "Freelance Guard <onboarding@resend.dev>", to: [to], subject, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`The email service answered ${res.status}`);
  return { sent: true };
}
