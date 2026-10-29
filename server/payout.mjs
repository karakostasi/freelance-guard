// How a payee chooses to be paid: into a bank account in euros (SEPA) or dollars (ACH), or by keeping the stablecoin in
// their wallet. The choice is read when the escrow releases a payment, so the payee can change it until then.

/** "sepa" pays euros to an IBAN, "ach" pays dollars to a US account, and "eurc" keeps the stablecoin in the wallet. */
export const ROUTES = ["sepa", "ach", "eurc"];

const fail = (message) => Object.assign(new Error(message), { status: 400 });

/** An IBAN with a correct check number (ISO 13616, mod 97). Country length rules are not checked. */
export function isValidIban(value) {
  const iban = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const digits = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** A US routing number: nine digits that pass the ABA check. */
export function isValidRouting(value) {
  const digits = String(value ?? "").replace(/\s+/g, "");
  if (!/^\d{9}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

const text = (value, what) => {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > 80) throw fail(`${what} must be 2 to 80 characters`);
  return clean;
};

/** Checks a saved choice and returns it in the form it is stored in. Throws a 400 for anything that is wrong. */
export function cleanPayout(body) {
  const route = body?.route;
  if (!ROUTES.includes(route)) throw fail("route must be sepa, ach or eurc");
  if (route === "eurc") return { route, updatedAt: Date.now() };
  const holder = text(body.holder, "The account holder's name");
  if (route === "sepa") {
    if (!isValidIban(body.iban)) throw fail("That IBAN isn't valid. Check it and try again");
    return { route, holder, iban: String(body.iban).replace(/\s+/g, "").toUpperCase(), updatedAt: Date.now() };
  }
  if (!isValidRouting(body.routing)) throw fail("That routing number isn't valid");
  const account = String(body.account ?? "").replace(/\s+/g, "");
  if (!/^\d{4,17}$/.test(account)) throw fail("An account number has 4 to 17 digits");
  return { route, holder, routing: String(body.routing).replace(/\s+/g, ""), account, updatedAt: Date.now() };
}

/** The currency a bank route pays in. Keeping the stablecoin involves none. */
export const currencyOfRoute = (route) => (route === "sepa" ? "EUR" : route === "ach" ? "USD" : null);

/** What anyone may see of a payee's choice: how they are paid and the last digits of the account, never the account. */
export function publicPayout(pref) {
  if (!pref) return { route: null };
  const account = pref.iban ?? pref.account;
  return { route: pref.route, currency: currencyOfRoute(pref.route), ...(account ? { last4: account.slice(-4) } : {}) };
}
