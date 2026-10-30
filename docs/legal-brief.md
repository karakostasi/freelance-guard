# Squirrel: brief for legal counsel

**Purpose.** We are asking for a legal opinion on whether, and under what conditions, we can offer the service below to businesses in the European Union with real money, and what we would have to do first. This brief states the facts as they are (what is built, what is only simulated, who can do what with the money) and the questions we need answered. It is written for a lawyer experienced in EU financial regulation (MiCA, PSD2 and the E-Money Directive, anti-money-laundering) who has not seen the product.

**What we would like back.** A written opinion, ideally with (a) a classification of each activity in section 4 for each architecture in section 5, (b) the lightest compliant way to start (section 7, question 1), and (c) what each route costs in time and money. If something needs more facts from us, tell us what. If a topic is outside your practice, tell us which and we will find a specialist.

**Status of this document.** The facts about the code are checked against it (references are to files in the repository we can share). The facts about third parties come from their public pages and are marked. The legal references are my reading of public sources, including secondary ones, **and are not advice**: they are there so you can see what we have looked at and where we may have it wrong.

Placeholders to fill before sending: **[ENTITY]**, **[COUNTRY OF INCORPORATION OR PLANNED]**, **[CONTACT]**.

## 1. In six lines

1. Squirrel is a **milestone escrow for business payments**. A payer funds a job; the money is held until the payer approves the work, stage by stage; then it goes to the payee.
2. The money is held as a **stablecoin (EURC or USDC) in a smart contract** on the Base network. Nobody at Squirrel can take escrowed money out of the contract (section 3).
3. A payer can pay **in euros or dollars by bank transfer or card**. A partner company turns that into the stablecoin and delivers it to the payer's wallet. A payee can be paid **to their bank account** by another partner, or keep the stablecoin.
4. People who have no crypto wallet get an **email login and a wallet made for them by Coinbase** (keys held by that service, our understanding to confirm). People who have a wallet use it.
5. Squirrel earns a fee per job: **0.25% (at least a minimum amount) from the payee, and 0.25% on top from the payer**, or none from the payer if their money earns yield while it waits (yield is off and not planned until you advise).
6. **Today it all runs on a test network with play money**, and the banks, checks and payouts are simulated. Nothing real has been done. The entity does not exist yet.

## 2. Who is who

| Role | Who | What they can do |
| --- | --- | --- |
| **Payer** | A business (consumers are not the target) | Funds a job, approves or disputes delivered work, takes the money back if nothing is delivered in time. Can name a **verifier**, someone who may approve in their place. |
| **Payee** | A business or freelancer | Delivers the work, claims payment if the payer doesn't answer in time. Chooses how to be paid. |
| **Arbiter** | Decided by Squirrel (planned: a multisig of ours; one address, fixed when the contract is deployed) | Decides a **disputed** milestone, all or nothing: the payee is paid or the payer is refunded. Cannot send the money anywhere else. |
| **Owner** | Squirrel (planned: a multisig of at least 3 signers, where at least 2 must approve each action; `docs/mainnet.md`) | Changes the rules for **new** jobs and switches tokens on and off (section 3). Cannot take escrowed money. |
| **Treasury** | Squirrel | Receives the fees, and only the fees. |
| **Wallet provider** | Coinbase (Developer Platform embedded wallets) | Creates and holds the wallet of people who sign in with an email. |
| **On-ramp and off-ramp partners** | Not chosen yet (`docs/providers.md`) | Turn euros into the stablecoin, and the stablecoin into euros. |
| **Stablecoin issuer** | Circle (USDC, EURC) | Issues and redeems the tokens. |

## 3. Who can do what with the money (the contract)

Source: `contracts/FreelanceEscrow.sol` (about 640 lines, with tests in `test/`). It has **not been audited**; an audit is planned before any real money.

**How escrowed money can leave the contract.** These are all the ways, and the functions are in the file:

| Money leaves by | Who can trigger it | Where it goes |
| --- | --- | --- |
| `approve` | The payer, or the job's verifier | The payee |
| `claimAfterTimeout` | The payee, after a review period the payer didn't use | The payee |
| `resolve` (after the payer's `dispute`) | The arbiter | The payee **or** the payer, nowhere else |
| `refundExpired` | The payer, if the payee didn't deliver by the deadline | The payer |
| `withdrawFees` | Anyone | **Only** the treasury, and **only** the accrued fees (it keeps what open milestones still need) |

There is **no function by which the owner, the arbiter or the treasury can send escrowed money to another address.** The payee's address is set when the job is created and can't be changed.

**What the owner can do** (planned as a multisig that needs at least two signatures for each action): switch a token on or off for new jobs and set its minimum fee, minimum job size and the payer's surcharge; set the fee rate (hard limit 1% in the contract); change the treasury; **pause** new jobs and funding (payments, approvals and refunds always keep working); empty the yield vault back into the contract (`exitVault`); hand ownership over in two steps. The terms of a job are fixed when it is created, so later changes by the owner never touch an existing job.

**What is fixed and can never be changed:** the contract's logic, the **arbiter's address** and the **review period** (a constant in the deployment).

**Time limits.** Money is never locked without a way out: the payee can always claim after the review period, the payer can always reclaim after a missed deadline, and a disputed milestone waits for the arbiter (the one case without a time limit).

**Tokens.** Only tokens the owner switched on (planned: Circle's USDC and EURC on Base). Tokens that take a fee on transfer are rejected.

**Yield.** The contract can put the escrowed USDC into an ERC-4626 vault and keep what it earns as fees. The payer's money comes back in full. **This is off, there is no real vault, and we won't turn it on before your opinion** (section 7, question 9).

**Questions this raises for you.** Our reading is that no one at Squirrel holds, controls or can move client money, because the rules are in the contract and nobody has a key to the escrowed balance. But the owner can pause and reconfigure, and **the arbiter decides disputed funds between two parties**. Whether that is "control" is exactly question 1 below.

## 4. The money flows

All amounts are in the stablecoin once on the chain. "Wallet" is the payer's or the payee's.

**A. A job paid from the payer's wallet** (the payer has EURC or USDC)

1. The payer signs one transaction that approves the token and creates the job; the escrow contract takes the tokens.
2. Squirrel's server reads the chain and shows the status. It does not move anything.
3. The payee delivers; the payer approves (or disputes, or the review period lapses); the contract pays the payee, less the fee, which stays in the contract until sent to the treasury.

**B. A job paid by bank transfer or card** (the payer has no stablecoin; **not yet real**)

1. The payer pays EUR to a partner (the on-ramp), by SEPA or card.
2. The partner delivers **EURC to the payer's wallet** (the email wallet, or the one they have). Squirrel's server is told by a webhook; **no money passes through an account of ours.**
3. The payer's wallet creates the job and deposits the EURC into the escrow, as in flow A. For the email wallet this is one batch, with the gas paid by Coinbase's sponsorship.
4. From there, as flow A.

**C. A payout to a bank account** (the payee chose it; **not yet real**)

1. The contract pays the payee **in the stablecoin, to the payee's wallet**, as in flow A. Squirrel does not hold it.
2. The payee's wallet (or the off-ramp partner's address, depending on the partner) sends the EURC to the partner, which pays EUR to the payee's IBAN by SEPA.
3. Squirrel only records the choice (the IBAN, kept in our database until the partner takes it over; section 6) and the status.

**D. A dispute.** The payer disputes inside the review period; the arbiter reads the delivered work and the job description and decides: pay the payee or refund the payer. Both sides can attach documents. The decision is on the chain.

**E. A refund after a missed deadline.** The payer reclaims from the contract; the EURC goes back to the payer's wallet. **Returning it to the payer's bank (or card) is not designed.**

**F. Fees.** The payee's fee (the larger of a minimum amount and 0.25% of the job) is kept in the contract out of what the payee receives, and sent to the treasury. The payer's 0.25% surcharge is added when funding, unless the job takes the yield. VAT on our fee, and invoicing of it, is not worked out.

## 5. The architectures we can see

These are the options we are comparing. We would like each classified.

- **Option 1: no fiat at all.** Payers and payees use stablecoins only. Squirrel is the smart contract and a website. No partner.
- **Option 2: licensed partners on both ends, nothing of ours in between.** As flows B and C: a licensed partner takes the euros and delivers the stablecoin to the payer's wallet; another (or the same) pays out to the payee's bank. The money never enters an account of Squirrel.
- **Option 3: partners as in option 2, but Squirrel is the contracting party and passes the customers on** (a white label, or it holds an account at the partner through which flows move).
- **Option 4: fiat held by a licensed payment institution in escrow** (a payments company holds the euros, the stablecoin is not used) with Squirrel as the platform. We are listing this only to ask whether it is the safer route; it is not the product.

## 6. What personal and business data we handle

| Data | Where | Notes |
| --- | --- | --- |
| Wallet addresses | On-chain and in our database | Public |
| **Job title and a short description** (up to 280 characters) | **On-chain** | Public and permanent |
| Longer descriptions, uploaded files, **business details** (company names, VAT IDs, PO reference) | Our database, addressed by a hash recorded on-chain | The file or document can be fetched by anyone who knows the hash |
| **Email address** (for notifications; only when confirmed) | Our database | Unsubscribe link in each email |
| **Bank details of a payee** (IBAN, or US routing and account number; **not yet collected on a real network**) | Our database, until a partner takes them | The last four digits are shown to the other party, the rest only to the payee |
| Login: for the email wallet, the email goes to Coinbase | Coinbase | Our app sends our server the wallet address, not the email |

On-chain data can't be erased. See question 11.

## 7. The questions

**Priority 1: they decide whether and how we can start**

1. **Our own status.** For each of options 1 to 4 and flows A to F, which regulated activities does Squirrel carry out, if any, under **MiCA** (we have looked at the definitions of *custody and administration of crypto-assets*, Art. 3(1)(17), *transfer services*, Art. 3(1)(26), and *exchange of crypto-assets for funds*, Art. 3(1)(19)), **PSD2** (is holding funds until a condition is met a payment service, and could the *commercial agent* exclusion apply when the platform acts for both payer and payee?) and the **E-Money Directive**? What is the effect of the smart contract's **owner** powers (pause, token configuration), and of the **arbiter** deciding disputed funds?
2. **Is a self-executing escrow contract, with the arbiter and owner as in section 3, "custody"?** If a non-custodial design is possible, what are the conditions (for example, no one can access the balance, the arbiter can only choose between the two parties)?
3. **Partners.** Do licensed on-ramp and off-ramp partners (options 2 and 3) carry the regulated activities, and what contract structure keeps it that way? What must we check about **their** authorisation and passporting? Does the **Coinbase embedded wallet** (keys held by Coinbase, as we understand it; to be confirmed) make Coinbase the custodian of our users' wallets, and does that change our position?
4. **Where and what entity.** In which country should **[ENTITY]** be incorporated, and as what kind of company, to apply for the partners' KYB and, if needed, a licence? What does a CASP authorisation or a payment institution licence cost, and how long does it take, in the countries you would consider?
5. **The lightest lawful start.** Is there a pilot (for instance: stablecoin only, invited businesses, a cap per job, no fiat) that can run before any licence, and under what conditions? If a notification or an exemption is available, which?

**Priority 2: before the first real euro with fiat**

6. **AML and sanctions.** Is Squirrel an *obliged entity*, in which of the options? What do we have to do about customer due diligence, monitoring and reporting, and what can we rely on partners for? The **Travel Rule** (Regulation 2023/1113) for transfers to and from wallets that the user controls or that Coinbase holds for them.
7. **Refunds to the original source.** A refund of a euro payment must go back to a bank or card. Who may do that, and can it be through the partner?
8. **Disputes and the arbiter.** Is deciding disputes between two businesses for a fee a regulated or otherwise restricted activity? What terms (jurisdiction, applicable law, limits of liability, an appeal) should the arbiter's role have? Who may be the arbiter?
9. **Yield.** **MiCA Art. 50** says issuers of e-money tokens and the providers of services for them can't grant **interest**, which we read broadly (any remuneration or benefit tied to how long a token is held). In our design the platform keeps the yield, and the payer who accepts it pays no surcharge. Is that **prohibited**, **allowed**, or **allowed in USDC and not in EURC**? Is putting client money in a lending protocol, with risk of loss, something we can offer at all, and with what disclosure and consent?
10. **Consumers.** We target businesses. What do we have to do to keep consumers out, and what if a freelancer is a consumer?

**Priority 3**

11. **GDPR.** We write job titles on a public, permanent chain and keep bank details and email addresses. Is the controller us or the partners? What of the right to erasure, and what should the privacy policy say? Do we need a DPIA?
12. **Terms and disclosure.** What must the terms say about who bears the risk of the smart contract, the stablecoin (de-peg, issuer failure), the wallet provider and the partners? Is a risk disclosure required?
13. **Tax.** VAT on our fee (a B2B service across borders), and invoices; whether the fee or the yield has other tax effects.
14. **US.** We would like to offer payouts to US bank accounts (ACH) later. Does that bring money-transmitter or state licensing, and should the pilot be EU-only?
15. **Liability and insurance.** What should the company's liability be limited to, what insurance is advisable, and what do directors need to know?
16. **Audit.** Does an audit of the contract have a regulatory role (as opposed to a technical one), and does it matter who does it?

## 8. What exists and what doesn't

| Real | Simulated (play money) | Not yet built |
| --- | --- | --- |
| The escrow contract and its tests (not audited) | The bank, the compliance screening, the exchange rate and the "proof of reserves" steps | Real on-ramp and off-ramp partners |
| The website and the server | The mint of the test stablecoin to the payer | Refund to the payer's bank or card |
| The email login (Coinbase) and a wallet login | The payout to a bank account | A legal entity, terms, a privacy policy |
| Two deployment scripts and checks for real money (`docs/mainnet.md`) | The yield vault | A payout for jobs paid from a wallet |

On a real network the server refuses to start with an unsafe setting, and keeps the simulated parts shut (`server/safety.mjs`).

## 9. What we have read

Secondary sources are marked. **Please treat our reading as a starting point and correct it.**

- MiCA, Regulation (EU) 2023/1114: Art. 3(1)(17) custody (the wording is quoted by several commentators; we have not checked it against EUR-Lex); Art. 3(1)(26) transfer services and ESMA's Q&A 2071 on transfers as a standalone service; Art. 50 prohibition of interest on e-money tokens ([ESMA's single rulebook](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-50-prohibition-granting-interest)); [ESMA guidelines on transfer services](https://www.esma.europa.eu/sites/default/files/2025-02/ESMA35-1872330276-2032_Guidelines_on_transfer_services_for_crypto-assets_under_MiCA.pdf) (February 2025).
- Commentary that control by smart contracts with administrative privileges can count as custody, and that labels such as "non-custodial" do not decide it: secondary (law-firm and blog commentary, for example [Lexology](https://www.lexology.com/library/detail.aspx?g=65ec0c23-248c-456c-a364-1942a5a85c21)).
- PSD2 and escrow: EBA Q&A [2020_5354](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2020_5354) and 2020_5355 on the commercial-agent exclusion, and the point (secondary) that it does not cover an agent acting for both sides. The UK FCA's perimeter guidance treats escrow as a payment service (UK, so an analogy at most). PSD3 and the Payment Services Regulation are proposed, not in force.
- Circle's redemption for businesses and individuals in the EEA: [circle.com/eea-redemptions](https://circle.com/en/eea-redemptions).

## 9b. Attachments we can send

`README.md` (what the product does), `docs/business-model.md` (the economics and earlier decisions, in Greek), `docs/mainnet.md` (keys, roles and the deployment), `docs/providers.md` (the partners we are comparing), the contract and its tests, and a demonstration on a test network, on request.
