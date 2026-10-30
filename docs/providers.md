# On-ramp and off-ramp providers

What Squirrel needs from the companies that turn euros and dollars into stablecoins and back, who offers it, what is known and what is not, and the questions to put to each. Research done on 30 October 2026, from public pages. **Nothing here is a quote, a recommendation to sign, or legal advice.** It is the preparation for the first calls.

How to read the marks: **(official)** is from the provider's own documentation or announcement. **(third party)** is from a comparison site, a blog or a search summary. **(not found)** means I looked and found nothing, which is not the same as "no". Anything that matters must be confirmed with the provider in writing.

## 1. What we need

The app already runs the whole journey on a test network, with sandboxes standing in for the companies below (`server/providers.mjs`). A real provider replaces each sandbox step:

| # | We need | Where it is used |
| --- | --- | --- |
| R1 | **In:** a payer pays EUR (or USD) by bank transfer, and ideally by card, and **EURC (or USDC) on Base arrives at the address of the payer's wallet** | "Pay by card or bank transfer" |
| R2 | The address is a **smart-contract wallet** (the email wallet, a Coinbase smart account that may not be deployed yet). The provider must be able to send to it | R1 with the email login |
| R3 | **Out:** the payee's EURC (or USDC) becomes EUR in their bank account by SEPA (USD by ACH in a later phase), **to an account in the payee's name that is not ours** | "How I get paid" |
| R4 | A **business customer** onboarding (KYB) for us, and a clear rule for **who checks the payer and the payee** (their KYC, the provider's or ours) | all |
| R5 | An **API with webhooks** and a **sandbox** that behaves like production | the backend (`server/pipeline.mjs`) |
| R6 | **Settlement time, limits and fees** that fit jobs of EUR 2,000 and up (the launch values in `docs/business-model.md`) | the economics |
| R7 | A clear answer on **who is the regulated party** at each step, and what that leaves for us | the legal brief (`docs/legal-brief.md`) |
| R8 | **Refunds and chargebacks** (card especially) after the money is already in escrow | disputes |

Two things this leaves open and that shape the rest:

- **The money must never rest with us.** In the design the stablecoin goes from the provider to the payer's wallet and from there into the escrow contract, and out of the contract to the payee's wallet and then to the provider. If instead a provider settles into an account of ours and we pass it on, we may ourselves be doing a regulated service. Which design is allowed is a question for counsel, so prefer providers that can pay **to the end customer directly** (R1, R3).
- **A provider will want a legal entity.** Every KYB needs company documents. Squirrel is a project, not yet a company. Which country and what kind of company comes first (see the legal brief), and the provider calls wait on that.

## 2. The candidates

### Bridge (owned by Stripe)

- **EUR both ways over SEPA.** In: a virtual IBAN for the customer, via SEPA Instant or SEPA Credit. Out: transfers to a EUR bank account, and **liquidation addresses**, an address the payee sends stablecoin to that is paid out to their bank. (official)
- The API reference for liquidation addresses lists `eurc` as a currency, `base` as a chain and `sepa` as a rail. (official, from the API reference; I haven't read every page)
- **EUR and SEPA need a "SEPA endorsement"** and a call with sales (`sales@bridge.xyz`). (official)
- **Sandbox:** on request (`support@bridge.xyz`), with dummy data and no real money. (official)
- The EUR guide's on-ramp examples use another token on another network, so **EURC on Base on the way in is not confirmed**. The licensed entity, fees and settlement times are **not stated** there. (official)
- Third-party payments (pay-ins from someone other than the customer) are marked "contact your account manager". Relevant to R1. (official)

### SpherePay

- **EURC is live on Base**, Ethereum and Solana, **both on-ramp** (EUR by SEPA, USD by ACH or wire, delivered to a configured wallet) **and off-ramp** (EUR by SEPA, USD by ACH or wire). Blog of 9 March 2026. (official)
- For customers "with completed KYC/KYB". A sandbox is mentioned. **Licensing, fees and limits are not stated.** (official)

### Circle (the issuer of USDC and EURC)

- Circle redeems EURC and USDC **directly for businesses and individuals in the EEA**. A business needs company formation documents, **a statement from an EEA bank that can receive SEPA payments**, and further KYC documents. (official)
- The European entity is Circle Internet Financial Europe SAS, a French e-money institution. (official, Circle's own blog)
- **Not stated:** minimums, fees, timing. One third-party page says a USD 50,000 minimum for minting; **I could not confirm it**.
- This is a **treasury route for a company** (one account that mints and redeems), not something that sends stablecoin to each customer's wallet. Using it for the platform's flows would make us the intermediary. Treat it as the **fallback for the payee's side** (and as the reference for what "redemption" means), not as the on-ramp.

### Ramp Network

- Third-party comparisons list EURC among its stablecoins, on Base, and SEPA at about 0.49% (**third party, to verify**).
- A search listing from 22 January 2026 says Ramp went live as an EU-licensed crypto-asset service provider under MiCA. **I could not read the announcement**, so the entity and the services covered are unconfirmed.
- Its 2024 page on SEPA payouts doesn't name assets or networks, and its footer lists entities in the UK, Ireland and the US and says "swaps are not available in the EU" for one product. **Which product and entity would serve us is a question for them.** (official)

### Transak

- **Production needs a KYB approval** (a form); the staging environment does not. Partners can set their own fee on top of Transak's and the network fee. (official FAQ)
- From earlier research (Transak's staging documentation, not written down in this repository): the staging environment delivers only its own test token on Base Sepolia, so it can't exercise our flow end to end. **Worth re-checking** before it counts against Transak.
- **EURC on Base is not confirmed** by anything I found. Fees: the figures I saw were third party and "to be verified".

### Coinbase Onramp and Offramp (CDP)

- Onramp is available in the countries where Coinbase operates, except Japan. **Base is supported.** Which countries, payment methods and assets: a live **Config API** answers it (`/onramp/v1/buy/config`, and `/onramp/v1/sell/config` for selling). (official)
- **SEPA and EURC are not confirmed** by anything I found.
- We already have a CDP project for the email login, which makes this the **natural first thing to check**: the Config API call settles whether EUR by SEPA and EURC on Base are on offer, in a few minutes, with no sales call.

### Monerium

- A licensed electronic money institution (authorised by the Central Bank of Iceland), issuing **EURe**, a euro e-money token tied to a personal IBAN. (official)
- Its published list of networks (Ethereum, Gnosis, Arbitrum, Scroll, Linea, Polygon) **does not include Base**, and EURe is a different token from EURC. Using it would mean adding that token to the escrow, and a different chain. **Unlikely to fit**, but it is the cleanest "IBAN to token" design, so it is worth a question.

### MoonPay and Mercuryo

- No source I found confirms EURC or SEPA for MoonPay. Mercuryo is listed by a third party as an enterprise option for EURC with SEPA. **Unconfirmed**; ask only if the others fail.

## 3. A first shortlist

By what is confirmed, not by who is better:

1. **Coinbase Onramp / Offramp.** Check the Config API today. No contract needed, and it sits with the project we already have.
2. **Bridge** and **SpherePay.** Both say EUR by SEPA and EURC on Base, both are built for businesses with a sandbox. Ask the questions below.
3. **Ramp Network.** Ask which entity and product would serve a EUR-by-SEPA flow from the EU, and in which countries.
4. **Circle direct**, as the way to understand redemption and as a fallback for the payee's side.

Transak, Monerium, MoonPay and Mercuryo only if the above fall short.

## 4. How to compare

Fill this in after the calls. A "?" is a question you still owe an answer.

| | Bridge | SpherePay | Ramp | Coinbase | Circle |
| --- | --- | --- | --- | --- | --- |
| EUR in by SEPA (R1) | | | | | |
| Card in (R1) | | | | | |
| EURC on Base delivered to a smart wallet (R2) | | | | | |
| EUR out by SEPA to a third party's IBAN (R3) | | | | | |
| Who checks the payer and the payee (R4) | | | | | |
| KYB: what they need from us, how long (R4) | | | | | |
| Sandbox that mirrors production (R5) | | | | | |
| Fees in and out, limits, settlement time (R6) | | | | | |
| Regulated entity, licence, passporting (R7) | | | | | |
| Refunds and chargebacks (R8) | | | | | |
| Contract: exclusivity, minimum volumes, termination | | | | | |

## 5. The questions to send

Copy into an email. Write it from the company, once it exists.

> We are building Squirrel, a milestone escrow for business payments. A payer funds a job in euros (or dollars); the money is held as a stablecoin (EURC or USDC) in a smart contract on Base until the work is approved; the payee can then be paid out to their bank account. We would like to use your service for the way in and the way out, in the EU first. A few questions, so we can see whether it fits:
>
> **The service**
> 1. Can you deliver **EURC on Base** to an address we give you, for a payer who pays **EUR by SEPA** (and by card)? And USDC for USD?
> 2. The address will often be a **smart-contract wallet that is not deployed yet** (an ERC-4337 account). Is that supported?
> 3. Can you **pay EURC out as EUR by SEPA to the payee's own IBAN**, where the payee is not our customer? Which currencies and rails besides SEPA (ACH, wire)?
> 4. Is there an **API with webhooks** for each step, and a **sandbox that behaves like production**? How do I get access?
>
> **Who is who**
> 5. Which **legal entity** provides the service to us and to our users, in which authorisation (MiCA CASP, EMI, payment institution), and in which countries does it passport?
> 6. **Who does KYC/KYB** on the payer and on the payee: you, or us? Do our users sign up with you, or do we pass their data?
> 7. Do we ever **hold or touch the funds**? Can the money go from the payer to the wallet and from the payee's wallet to the bank, with you as the only party in between?
> 8. What do you need from **us** to onboard (documents, policies, a regulated status of our own)?
>
> **Money**
> 9. **Fees** in and out (fixed and percentage), and any minimum. Is our own fee on top allowed?
> 10. **Limits** per transaction, per day, per customer. Settlement times for SEPA Instant and SEPA Credit, in and out.
> 11. **Card payments**: chargebacks and refunds after the money is already in the escrow. Who carries the risk?
> 12. What happens when a payment **fails or is returned**, or the payee's IBAN doesn't match the name?
>
> **Compliance**
> 13. How do you handle the **Travel Rule** for transfers to and from wallets we or our users control?
> 14. What **sanctions and AML** screening do you do, and what do you report to us?
> 15. Where is customer **data stored**, and who is the controller under GDPR?
>
> **Business**
> 16. Is there a **minimum volume or commitment**? What is the **contract** term and the notice to leave?
> 17. How long does onboarding take, from the first call to production?
> 18. Can we talk to a business that already uses you for something like this?

## 6. What to have ready

Almost every provider will ask for these. Most cannot be written by me:

- the **company**: registration document, directors, **beneficial owners**, address, bank account;
- a **description of the business** and of the flows (the two flow diagrams in `docs/legal-brief.md` are written for this);
- the **website** with terms and a privacy policy;
- an **AML and sanctions policy**, even a short one (they will ask what you do about the people on your platform);
- the **expected volumes**: number and size of jobs in the first year, and the countries;
- the **smart contract**: its address, the audit report when there is one, and who holds the keys (`docs/mainnet.md`).

## 7. How long it takes

My estimates, not quotes: a first call within a week or two; KYB and a legal review by the provider 2 to 8 weeks; integration in the app 1 to 3 weeks once the sandbox is open (the app's side is mostly built: the sandbox steps are replaced one by one). They run in parallel with the audit and the legal opinion, so the critical path is the slowest of the three, not their sum. The company has to exist before any KYB starts.

## 8. What the app needs when one is chosen

For whoever builds it, so the choice isn't a surprise later:

- a `server/providers.mjs` implementation of `bank`, `aml`, `fx`, `mint` and `offramp` against the real API (the sandbox ones are the interface to keep);
- real inbound webhooks with signature checks instead of `/webhooks/bank` and `/api/sandbox/bank-transfer` (both are shut on a real network);
- the payer-side refund path (not designed yet);
- an answer to **wallet-paid jobs**, which today have no payout run;
- `bankRails` in `/api/health` turned on only when a real provider is behind it.
