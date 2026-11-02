# Squirrel: κατάσταση του έργου και περίληψη για τη διπλωματική

**Τελευταία ενημέρωση: 2026-11-02, βάση commit `49c2fd9` (main).**

Αυτό το αρχείο είναι η **πηγή αλήθειας** για το τι ισχύει στο έργο τώρα. Το προϊόν λέγεται Squirrel και το repo `freelance-guard`. Το διαβάζει και το Claude του project της διπλωματικής. Η γλώσσα της διπλωματικής είναι τα ελληνικά.

## Κανόνας ενημέρωσης

- **Αν αυτό το αρχείο διαφωνεί με άλλο αρχείο του repo, νικάει αυτό και διορθώνεται το άλλο.**
- Κάθε PR που αλλάζει κατάσταση, απόφαση ή το τι είναι sandbox και τι πραγματικό ενημερώνει αυτό το αρχείο **στο ίδιο PR**, με νέα ημερομηνία και commit στην κορυφή.
- Κάθε ισχυρισμός γράφεται ως υπόθεση, σχεδιασμένο, υλοποιημένο, δοκιμασμένο ή επαληθευμένο. Ό,τι δεν έχει επαληθευτεί λέγεται ρητά.
- Όταν αλλάζει, ξανανεβαίνει στο project του claude.ai (διαγραφή του παλιού, ανέβασμα του νέου).

## Τι ρόλο έχει κάθε αρχείο

| Αρχείο | Τι περιέχει | Πού είναι |
|---|---|---|
| `docs/thesis-context.md` | Η κατάσταση τώρα, τι είναι sandbox, ανοιχτά θέματα | Αυτό το αρχείο |
| `README.md` | Πώς δουλεύει και πώς τρέχει το σύστημα (αγγλικά) | Ρίζα του repo |
| `docs/business-model.md` | Μοντέλο επιχείρησης, ανταγωνισμός, αριθμοί (υποθέσεις), οι 14 αποφάσεις | `docs/` |
| `docs/contract-v2-design.md` | Τεχνικός σχεδιασμός του contract v2 | `docs/` |
| `docs/mainnet.md` | Τι χρειάζεται για πραγματικά λεφτά και τι κάνει ο κώδικας για να είναι ασφαλές (αγγλικά) | `docs/` |

## Πώς να χρησιμοποιηθεί αυτό το αρχείο

- Για την **κατάσταση** ισχύει πάντα αυτό. Για **λεπτομέρειες και αριθμούς** πήγαινε στα αναλυτικά αρχεία, αφού ελέγξεις ότι δεν διαφωνούν με αυτό.
- **Οι αριθμοί του business-model.md είναι υποθέσεις**, όχι στοιχεία αγοράς (το λέει το ίδιο το αρχείο). Μην τους παρουσιάσεις ως ευρήματα. Το επιτόκιο 4% του USDC και το βάθος της αγοράς στο Aave Base δεν έχουν επαληθευτεί.
- Η πρώτη γραμμή του README λέει "on Ethereum". Είναι παλιά. Το σύστημα τρέχει στο **Base** (Base Sepolia για δοκιμές).
- Ό,τι δεν έχει δοκιμαστεί ή επαληθευτεί σημειώνεται ρητά παρακάτω. Μην το γράφεις στη διπλωματική σαν να ισχύει.
- Τα ονόματα συναρτήσεων, αρχείων και token μένουν στα αγγλικά.

## 1. Τι είναι το Squirrel

B2B **milestone escrow** για ψηφιακές υπηρεσίες (software agencies, SaaS integrations, tech consulting). Ο **payer** κλειδώνει την πληρωμή σε smart contract (`FreelanceEscrow.sol`) στο Base, σε USDC, EURC ή ETH. Ο **payee** παραδίδει, ο payer εγκρίνει, και το contract πληρώνει ανά milestone. Αν ο payer σιωπά μετά την περίοδο ελέγχου (3 ημέρες), ο payee παίρνει τα χρήματα. Αν υπάρχει διαφωνία, αποφασίζει ένας arbiter (όλο ή τίποτα). Αν δεν παραδοθεί τίποτα μέχρι το deadline, ο payer παίρνει πίσω τα χρήματα.

Βασικοί όροι: **payer**, **payee**, **verifier** (διεύθυνση που εγκρίνει milestones για τον payer), **arbiter**, **owner**, **treasury**.

## 2. Χρονολόγιο

Η ανάπτυξη έγινε από 2026-10-13 έως 2026-10-30: περίπου 109 commits και 49 pull requests.

| Περίοδος | Τι έγινε |
|---|---|
| 13–14 Οκτ | Αρχικό contract και React frontend, wallet connect, Base Sepolia |
| 20–22 Οκτ | Backend για το payment flow, deploy (Render, Supabase, Vercel), ERC-20 πληρωμές, milestones, CI και e2e test, επισυνάψεις αρχείων, emails σε κάθε βήμα |
| 26–28 Οκτ | Μετονομασία client/freelancer σε payer/payee, απόδειξη πληρωμής (receipts), μοντέλο επιχείρησης, **contract v2** (whitelist token, fees, surcharge, verifier, vault και yield), απλούστερο UI |
| 29 Οκτ | Πληρωμή σε ευρώ ή δολάρια, ο payee διαλέγει πώς πληρώνεται, είσοδος με email (Coinbase Embedded Wallets) |
| 30 Οκτ | Προετοιμασία για mainnet: μία ρύθμιση για το δίκτυο, server που αρνείται ανασφαλείς ρυθμίσεις, προσεκτικό deploy |
| 31 Οκτ – 2 Νοε | Έλεγχος και αίτηση για Coinbase Onramp/Offramp (ενότητα 6) |

## 3. Αρχιτεκτονική

- **Smart contract:** `contracts/FreelanceEscrow.sol` (Solidity, Hardhat). Εκδοχή v2: whitelist tokens που ορίζει ο owner, fee, επιβάρυνση, προαιρετικός verifier ανά job, ERC-4626 vault για yield. Λεπτομέρειες στο `contract-v2-design.md`.
- **Frontend:** React, TypeScript, Vite, wagmi και viem. Φιλοξενείται στο Vercel.
- **Backend:** Node (`server/`), φιλοξενείται στο Render, με Postgres (Supabase). Δέχεται το webhook της τράπεζας, διαβάζει τα events του contract, τρέχει το payment pipeline, στέλνει emails, κρατά τα έγγραφα των jobs.
- **Πορτοφόλι:** είσοδος με email μέσω **Coinbase CDP Embedded Wallets** (smart account, gas sponsored στο Base Sepolia), ή MetaMask για όποιον έχει ήδη πορτοφόλι.
- **Providers (τράπεζα, AML, FX, off-ramp):** **sandboxes** στο `server/providers.mjs`, σχεδιασμένοι να μοιάζουν με τους πραγματικούς.
- **Tests:** 5 αρχεία Hardhat tests για το contract, unit tests (`npm run test:unit`), e2e έλεγχος του payment flow (`npm run test:flow`, σηκώνει δική του αλυσίδα και backend), και GitHub Actions CI σε κάθε PR (lint, build, tests, έλεγχος ότι το committed ABI ταιριάζει με το contract).

## 4. Βασικές αποφάσεις και γιατί

Ο πλήρης πίνακας είναι στο `business-model.md`, ενότητα 6 (14 αποφάσεις). Οι πιο χρήσιμες για τη διπλωματική:

- **Τιμή:** ο payee πληρώνει `max(€40, 0,25%)` ανά milestone που απελευθερώνεται. Ο payer πληρώνει +0,25% όταν το job δεν τοκίζεται. Ελάχιστο job €2.000. Όλοι οι αριθμοί είναι υποθέσεις.
- **Yield μόνο για USDC, μόνο σε testnet:** το κεφάλαιο επιστρέφεται πάντα ολόκληρο και το yield είναι έσοδο της πλατφόρμας. Το EURC μένει εκτός επειδή η αγορά του στο Aave Base είναι μικρή και με χαμηλά επιτόκια. Το yield μένει κλειστό μέχρι να υπάρξει νομική γνώμη.
- **Opt-out αντί για opt-in** για το yield: ο payer που το αρνείται πληρώνει +0,25%. Αρχικά είχε επιλεγεί opt-in, αλλά δεν έδινε κίνητρο. Το ρίσκο είναι ότι οι περισσότεροι δεν αλλάζουν προεπιλογές (ενότητα 5 του business-model.md).
- **Συνέπεια που πρέπει να αναλυθεί:** οι πελάτες σε ευρώ (EURC) πληρώνουν πάντα 0,5% συνολικά, ενώ οι πελάτες σε USDC μπορούν να πληρώνουν το μισό. Το μοντέλο ευνοεί τους πελάτες σε USDC. Έχουν εξεταστεί τρεις δρόμοι (Α, Β, Γ) και επιλέχθηκε ο Α για αργότερα (απόφαση 9).
- **Ο payee αποφασίζει πώς πληρώνεται** (SEPA σε ευρώ, ACH σε δολάρια, ή stablecoin στο πορτοφόλι του), όχι ο payer (απόφαση 14).
- **Embedded wallet:** ο payer δεν χρειάζεται να ξέρει crypto. Δοκιμάστηκε και το Base Account (passkey, κλειδιά στον χρήστη), αλλά τα νέα accounts δεν στέλνουν συναλλαγές στο Base Sepolia (base/account-sdk #363).
- **Ανταγωνιστής:** Paycifi (Βέλγιο, 0,5% για stablecoin escrow, έως 1,5% με fiat ramp). Οι δύο ιδέες διαφοροποίησης (yield, αυτόματη επαλήθευση) είναι ήδη στο roadmap του. Οι πληροφορίες είναι από τις δικές τους σελίδες, χωρίς ανεξάρτητες κριτικές.

## 5. Τι είναι πραγματικό και τι sandbox

| Κομμάτι | Κατάσταση |
|---|---|
| Escrow contract v2 (milestones, whitelist token, fees, surcharge, verifier, vault και yield, refund, dispute) | **Υλοποιημένο και δοκιμασμένο με tests**, στο `main` (PR #38, 2026-10-28). Το ABI είναι committed στο `abi/` και το CI ελέγχει ότι ταιριάζει. **Δεν έχει γίνει audit.** |
| Έλεγχοι που περιορίζουν τη ζημιά πριν από το audit | **Υλοποιημένοι και δοκιμασμένοι με tests, όχι σε `main` μέχρι να γίνει merge το PR τους:** `maxJob` ανά token (υποχρεωτικό για να ενεργοποιηθεί token, μετράει μόνο νέα jobs), `guardian` που μπορεί μόνο `pause()`, και constructor που αρνείται arbiter `address(0)`. Τα deploy scripts τα απαιτούν και το `check-deployment` τα ελέγχει. Δεν έχουν δοκιμαστεί με πραγματικό Safe |
| Frontend και backend πάνω στο v2 | Υλοποιημένα, στο `main`. Το παλιό §10 του `contract-v2-design.md` τα έδειχνε ως ημιτελή, ήταν λάθος και διορθώθηκε |
| Deploy σε Base Sepolia | **Δεν επαληθεύεται από το repo.** Η διεύθυνση του contract ζει στις μεταβλητές του Vercel και του Render |
| Deploy σε Base mainnet | **Δεν έχει γίνει.** Υπάρχει script με dry-run (`deploy-mainnet.cjs`, `check-deployment.cjs`), αλλά όχι φάκελος `deployments/` |
| Emails, receipts | Υλοποιημένα |
| Πληρωμή σε € ή $ (κάρτα, τράπεζα) | **Sandbox.** Στο testnet το backend κόβει mock token στον payer. Σε πραγματικό δίκτυο ο server κρατά το sandbox κλειστό |
| AML, FX, payout σε τράπεζα | **Sandbox.** Δεν κινείται χρήμα |
| Yield | **Mock vault** μόνο. Δεν υπάρχει adapter για πραγματική αγορά δανεισμού |
| Embedded wallet (email) | Ο κώδικας ελέγχθηκε με types και stand-in wallet. **Δεν έχει δοκιμαστεί με πραγματικό CDP project**: ο κωδικός email, το smart account και το sponsored gas |
| Συνδρομές και GitHub/Jira auto-approval | Δεν υπάρχουν ακόμα (σχεδιασμένο, όχι χτισμένο) |

## 6. Coinbase Onramp / Offramp (2026-10-31 έως 2026-11-02)

Στόχος: να πληρώνει ο payer με ευρώ και να καταλήγει EURC/USDC στο Base (on-ramp), και ο payee να πουλά και να παίρνει ευρώ (off-ramp). Σήμερα αυτό υπάρχει μόνο ως sandbox (ενότητα 5).

**Τι χτίστηκε.** Το `scripts/coinbase-onramp-check.mjs` (με βοηθητικό κώδικα στο `scripts/lib/coinbase-onramp.mjs`). Είναι script μόνο ανάγνωσης: υπογράφει JWT με CDP Secret API key (Ed25519 ή ECDSA, χωρίς SDK) και ρωτά τα `/onramp/v1/{buy,sell}/config` και `/options?country=` για χώρες της ΕΕ. Δείχνει αν προσφέρεται EUR και αν το EURC/USDC είναι στο Base με τη διεύθυνση της Circle. Δεν κινεί χρήματα. Τρέχει με `npm run check:onramp`. Είναι στο repo (branch `coinbase-onramp-check`, PR προς το `main`). **Δοκιμασμένο με unit tests:** η υπογραφή του JWT (Ed25519 και ECDSA), το διάβασμα των απαντήσεων και ο πίνακας. **Δεν έχει επαληθευτεί με το πραγματικό API:** όλες οι κλήσεις μέχρι τώρα έδωσαν 404, άρα ο κώδικας δεν έχει δει ποτέ πραγματική απάντηση του Coinbase.

**Τι βρέθηκε.**
- Χρειάζεται **Secret API key**. Το Client API key δεν κάνει για τα REST APIs του Onramp/Offramp (το λέει το quickstart του Coinbase).
- Το αποτέλεσμα ήταν `HTTP 404: failed to find app with cloud project id …`. Το key είναι έγκυρο (αλλιώς θα ήταν 401), αλλά το project δεν έχει Onramp "app" στο Coinbase.
- Στο CDP Portal υπάρχει φόρμα "Get access to Coinbase Onramp & Offramp". Λέει ότι χρειάζεται μόνο για production και ότι πρέπει να έχεις ήδη staging ή production υλοποίηση. Δεν έχει επιβεβαιωθεί αν η φόρμα είναι ο μόνος τρόπος να δημιουργηθεί το app.
- Επιλέχθηκαν: προϊόντα **Offramp** και **Coinbase Authenticated Onramp - Hosted Widget**, δίκτυο **Base**, wallet provider **Coinbase Embedded Wallet**. Το Guest Onramp αποκλείστηκε επειδή, από όσα ξέρουμε, ισχύει για ΗΠΑ (δεν επιβεβαιώθηκε).
- Το Coinbase απάντησε με πέντε ερωτήσεις: end-to-end flow, wallet custody model, ποιος κρατά τα onramped funds, URLs με ενσωματωμένο Onramp, και τι εννοούμε με "Convert Crypto to Fiat". Ζήτησε και τις απαιτήσεις ασφαλείας: το backend να ταυτοποιεί τον χρήστη πριν ζητήσει session token, και το `Access-Control-Allow-Origin` να μην είναι `*`.

**Τι δεν είναι επιβεβαιωμένο.**
- Ότι το Onramp είναι ενσωματωμένο: **δεν είναι**. Ο κώδικας δεν καλεί το Coinbase Onramp/Offramp πουθενά πέρα από το check script. Η απάντηση προς το Coinbase το λέει ανοιχτά.
- Το έγγραφο των payment methods του Coinbase δεν έχει τιμή SEPA, άρα "προσφέρεται EUR" δεν σημαίνει "δουλεύει SEPA". Θέλει γραπτή επιβεβαίωση από το Coinbase, μαζί με το αν μπορεί να το χρησιμοποιήσει επιχείρηση και αν επιτρέπεται για πλατφόρμα σαν τη δική μας.
- Στον server, αν το `CORS_ORIGIN` είναι κενό, απαντά με `*`. Σε πραγματικό δίκτυο αρνείται να ξεκινήσει έτσι, αλλά στο staging πρέπει να οριστεί ρητά.
- Η απάντηση προς το Coinbase γράφτηκε ως πρόχειρο. **Κατάσταση αποστολής και απάντησής τους: [συμπλήρωσε εσύ].**

**Ποιος κρατά τι (όπως δηλώθηκε στο Coinbase, από τον κώδικα και τα docs).** Τα κλειδιά του embedded wallet τα κρατά η υπηρεσία της Coinbase, όχι ο χρήστης ούτε το Squirrel. Τα onramped tokens πηγαίνουν στο πορτοφόλι του payer, και μετά ο payer τα καταθέτει στο escrow. Ο arbiter μπορεί μόνο να πληρώσει τον payee ή να επιστρέψει στον payer. Ο owner δεν μπορεί να αγγίξει υπάρχον job ούτε να πάρει χρήματα από το escrow (είναι από το `mainnet.md`, και η λίστα των onlyOwner συναρτήσεων στο contract δεν έχει withdraw).

## 7. Νομικά και ρυθμιστικά (ανοιχτά)

Η διπλωματική πρέπει να τα αναλύει ως ανοιχτά θέματα, όχι ως λυμένα.

- Η κράτηση κεφαλαίων τρίτων και η απόδοση πάνω τους μπορεί να πέσει σε **MiCA, payment institution ή deposit-taking**. Θέλει νομική γνώμη πριν από πραγματικά λεφτά. Το yield μένει κλειστό μέχρι τότε.
- **Ποιος είναι custodian** των email wallets και **ποιος είναι CASP**: ανοιχτό (απόφαση 13 στο business-model.md).
- Τι πρέπει να λένε οι όροι χρήσης, ειδικά για το ρίσκο πρωτοκόλλου και stablecoin (exploit, depeg).
- Μια προεπιλογή yield "ενεργό" χωρίς ενεργή συναίνεση θέλει σαφή ενημέρωση.

## 8. Mainnet: τι υπάρχει και τι όχι

Το `mainnet.md` περιγράφει αναλυτικά τι κάνει ο κώδικας για να είναι ασφαλές το deploy και τι δεν μπορεί να κάνει. Συνοπτικά:

- Δύο ξεχωριστά **Safe multisigs**: owner και arbiter. Το κλειδί του deploy δεν έχει κανέναν ρόλο και ο owner μπαίνει στον constructor. Ο arbiter είναι **σταθερός στο contract** και δεν αλλάζει ποτέ.
- Το deploy script αρνείται, με λόγο, σε λάθος δίκτυο, ρόλους που δεν είναι Safe, λάθος tokens ή βρώμικο working tree. Στέλνει μόνο με `EXECUTE=1` και `CONFIRM_CHAIN_ID=8453`.
- Ο server σε πραγματικό δίκτυο αρνείται να ξεκινήσει με ανασφαλείς ρυθμίσεις, και το sandbox μένει κλειστό.
- **Guardian και `maxJob`:** το deploy script απαιτεί `GUARDIAN_ADDRESS` (ή `none` ρητά, με προειδοποίηση) και `USDC_MAX_JOB`/`EURC_MAX_JOB`. Ο guardian ορίζεται από το Safe του owner μετά το deploy, με το batch που γράφει το script. Μπορεί μόνο `pause()`: δεν κάνει unpause, δεν αλλάζει κανόνα, δεν αγγίζει χρήματα. Το `maxJob` το ανεβάζει ο owner με `configureToken`, και το `check-deployment` δείχνει WRONG μέχρι να ενημερωθεί το `deployments/base.json`.
- **Δεν έχουν γίνει:** audit του contract, νομική γνώμη, πραγματικοί providers για τράπεζα και ramp, πραγματικό yield vault, τιμή ETH/USDC σε ευρώ, όριο στο συνολικό ποσό που κρατά το escrow ανά token (το `maxJob` μετράει ένα job), έξοδος για milestone σε `Disputed` αν ο arbiter δεν αποφασίσει ποτέ (θέλει απόφαση για το ποιος κερδίζει από προεπιλογή), timelock στις εξουσίες του owner.

## 9. Ανοιχτά θέματα και ό,τι δεν έχει επαληθευτεί

- Επιτόκιο και βάθος USDC στο Aave Base (υπόθεση 4%).
- Πόσοι payers θα αρνούνταν το yield, και η προθυμία των payers και payees να πληρώσουν 0,25%. Θέλουν συνεντεύξεις με agencies (οι ερωτήσεις είναι στο `business-model.md`, ενότητα 7).
- Πραγματική δοκιμή με CDP project (email code, smart account, sponsored gas, paymaster στο mainnet).
- Το αρχείο του Safe Transaction Builder (`deployments/base.safe-config.json`) δεν έχει δοκιμαστεί με πραγματικό Safe.
- Αν το Coinbase θα δώσει πρόσβαση και τι ακριβώς καλύπτει για Ελλάδα και ΕΕ, SEPA και επιχειρήσεις.
- Πότε και με ποια επιβάρυνση ανοίγει το EURC.

## 10. Πιθανή αντιστοίχιση υλικού με ενότητες

Είναι πρόταση, όχι απαίτηση. Η δομή της διπλωματικής την ορίζεις εσύ.

| Ενότητα | Βασικό υλικό |
|---|---|
| Πρόβλημα και αγορά | `business-model.md` ενότητες 1, 2 |
| Σχεδιασμός του συστήματος | `README.md`, `contract-v2-design.md`, ενότητα 3 εδώ |
| Οικονομικό μοντέλο | `business-model.md` ενότητες 3, 4, 5 (με σαφή επισήμανση ότι είναι υποθέσεις) |
| Υλοποίηση και δοκιμές | ενότητες 3 και 5 εδώ, `README.md` (Tests and CI) |
| Ασφάλεια και mainnet | `mainnet.md`, `contract-v2-design.md` ενότητα 7 |
| Ρυθμιστικό πλαίσιο και custody | ενότητα 7 εδώ, `business-model.md` ενότητα 5 και απόφαση 13 |
| Fiat ramps (Coinbase) | ενότητα 6 εδώ |
| Περιορισμοί και μελλοντική δουλειά | ενότητα 9 εδώ, "Known limitations" στο `README.md` |

## 11. Οδηγίες για το Claude του project

- Μην εφευρίσκεις αριθμούς, πηγές ή αποτελέσματα. Αν κάτι δεν υπάρχει στα αρχεία, πες ότι δεν υπάρχει.
- Ξεχώριζε πάντα **υπόθεση, υλοποιημένο, δοκιμασμένο και επαληθευμένο**. Ό,τι είναι sandbox ή mock να λέγεται sandbox ή mock.
- Μην παρουσιάζεις νομικά συμπεράσματα (MiCA, custody, CASP) ως δεδομένα. Είναι ερωτήματα για νομικό σύμβουλο.
- Οι πηγές για τον ανταγωνισμό και το Aave είναι στο τέλος του `business-model.md` και έχουν ημερομηνίες πρόσβασης. Έλεγξέ τις πριν χρησιμοποιηθούν ως παραπομπές.
- Μείνε στα ελληνικά για το κείμενο της διπλωματικής.
