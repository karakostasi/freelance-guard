// Asks Coinbase what it offers in Europe, with your own CDP API key: can a payer buy with euros and land EURC or USDC on Base
// (on-ramp), and can a payee sell them and get euros (off-ramp). It only reads. It moves no money and creates nothing.
//
//   node scripts/coinbase-onramp-check.mjs --key-file ~/Downloads/cdp_api_key.json
//   node scripts/coinbase-onramp-check.mjs --key-file ~/Downloads/cdp_api_key.json --countries NL,DE --save onramp.json
//   node scripts/coinbase-onramp-check.mjs --key-file ~/Downloads/cdp_api_key.json --eu     (all 27 EU countries)
//
// The key: CDP Portal (portal.cdp.coinbase.com) > API Keys > Secret API keys > Create. The file it downloads has the id and
// the private key. Keep it outside this repo. Instead of --key-file you can set CDP_API_KEY_ID and CDP_API_KEY_SECRET, or
// ENV_FILE=path to a file that has them. The secret is never printed.
//
// What the answer can and can't tell you: the documented list of payment methods has no SEPA value, so "EUR is offered" is
// not the same as "SEPA works". The table shows the ids Coinbase returns, as they are. Send the output (or the --save file) to
// whoever decides, and confirm SEPA with Coinbase in writing.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { API_HOST, DEFAULT_COUNTRIES, EU_COUNTRIES, describeFailure, makeJwt, mentionsSepa, renderTable, summarizeCountry } from "./lib/coinbase-onramp.mjs";

const USAGE = "Usage: node scripts/coinbase-onramp-check.mjs --key-file <cdp_api_key.json> [--countries NL,DE,...] [--eu] [--save <file>]";

function parseArgs(argv) {
  const args = { countries: DEFAULT_COUNTRIES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value.\n${USAGE}`);
      return argv[++i];
    };
    if (a === "--key-file") args.keyFile = value();
    else if (a === "--save") args.save = value();
    else if (a === "--eu") args.countries = EU_COUNTRIES;
    else if (a === "--countries") args.countries = value().split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown option ${a}.\n${USAGE}`);
  }
  if (args.countries.some((c) => !/^[A-Z]{2}$/.test(c))) throw new Error("Countries are two letters each, like NL,DE.");
  return args;
}

/** The key id and secret, from the file the CDP Portal gives (new keys: id, older ones: name) or from the environment. */
function readCredentials(args, env) {
  if (args.keyFile) {
    const path = args.keyFile.startsWith("~/") ? homedir() + args.keyFile.slice(1) : args.keyFile;
    const file = JSON.parse(readFileSync(path, "utf8"));
    return { keyId: file.id ?? file.name, secret: file.privateKey };
  }
  return { keyId: env.CDP_API_KEY_ID, secret: env.CDP_API_KEY_SECRET };
}

async function call(base, creds, path, query = {}) {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const token = makeJwt({ ...creds, host: url.host, path: url.pathname });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON, shown as text */ }
  if (!res.ok) throw Object.assign(new Error(describeFailure(res.status, body)), { status: res.status });
  return body;
}

export async function run(argv, out = console.log) {
  const args = parseArgs(argv);
  if (args.help) return out(USAGE);
  if (process.env.ENV_FILE) process.loadEnvFile(process.env.ENV_FILE);
  const creds = readCredentials(args, process.env);
  if (!creds.keyId || !creds.secret) throw new Error(`No API key. Give --key-file, or set CDP_API_KEY_ID and CDP_API_KEY_SECRET.\n${USAGE}`);
  const base = process.env.ONRAMP_API_URL || `https://${API_HOST}`;
  const raw = { checkedAt: new Date().toISOString(), countries: args.countries };

  out(`Asking ${new URL(base).host} about ${args.countries.join(", ")} ...`);
  const configs = {};
  for (const kind of ["buy", "sell"]) {
    try {
      configs[kind] = await call(base, creds, `/onramp/v1/${kind}/config`);
    } catch (e) {
      if (e.status === 401) throw new Error(`${e.message}\nThe key was refused: check the key id and secret belong together, the key isn't deleted, and this computer's clock is right (the token lasts 2 minutes).`);
      if (e.status === 403) throw new Error(`${e.message}\nThe key is known but not allowed here: check the project has Onramp/Offramp turned on in the CDP Portal (not verified what the portal calls it).`);
      throw e;
    }
  }
  raw.config = configs;

  out("");
  const summaries = { buy: [], sell: [] };
  raw.options = {};
  for (const code of args.countries) {
    for (const kind of ["buy", "sell"]) {
      let options = null;
      let error;
      try {
        options = await call(base, creds, `/onramp/v1/${kind}/options`, { country: code });
      } catch (e) {
        error = e.message;
      }
      (raw.options[kind] ??= {})[code] = options ?? { error };
      summaries[kind].push(summarizeCountry(code, kind, { config: configs[kind], options, error }));
    }
  }

  const euMissing = (kind) => EU_COUNTRIES.filter((c) => !(configs[kind].countries ?? []).some((x) => x.id === c));
  for (const [kind, title] of [["buy", "ON-RAMP (a payer buys with EUR)"], ["sell", "OFF-RAMP (a payee sells and gets EUR)"]]) {
    out(renderTable(title, summaries[kind]).join("\n"));
    out(`  Coinbase lists ${(configs[kind].countries ?? []).length} countries in all. EU countries it does NOT list: ${euMissing(kind).join(", ") || "none"}.`);
    out(`  Does any answer name SEPA? ${summaries[kind].some(mentionsSepa) ? "yes, see the methods above" : "no"}\n`);
  }
  out("Not proven by this: that SEPA is the rail behind a bank method, fees, payout times, whether a business (not a person) can use it,\nand whether it is allowed for a platform like ours. Ask Coinbase for those in writing.");

  if (args.save) {
    writeFileSync(args.save, JSON.stringify(raw, null, 2));
    out(`\nThe raw answers are in ${args.save} (public data, no key in it).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((e) => {
    const cause = e.cause?.code ? ` (${e.cause.code}${/CERT|SELF_SIGNED/.test(e.cause.code) ? ": a company network may need NODE_EXTRA_CA_CERTS=<your CA bundle>" : ""})` : "";
    console.error(`\n${e.message}${cause}`);
    process.exit(1);
  });
}
