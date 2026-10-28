# Squirrel: τεχνικό design του contract v2 (πρόχειρο)

Ημερομηνία: 2026-10-28. Κατάσταση: draft για έγκριση, χωρίς κώδικα. Βάση: οι αποφάσεις #1–#12 στο [business-model.md](business-model.md). Οι αναφορές σε γραμμές είναι στο τωρινό `contracts/FreelanceEscrow.sol`.

## 1. Τι αλλάζει

**Μένουν ίδια:** milestones, ροή status (`Unfunded → Funded → Submitted → Disputed/Paid/Refunded`), review period, ο `arbiter` ως immutable διεύθυνση, `refundExpired`, `claimAfterTimeout`, `dispute`, ο έλεγχος fee-on-transfer tokens.

**Προστίθενται:**
- fee payee `max(minFee, 0,25%)` που αφαιρείται στην πληρωμή κάθε milestone, χωρίς fee σε refund,
- επιβάρυνση payer 0,25% στη χρηματοδότηση όταν το job δεν μπαίνει σε vault, που δεν επιστρέφεται,
- προαιρετικός `verifier` ανά job που μπορεί να καλέσει `approve`,
- vault (ERC-4626) για yield, μόνο USDC στο launch, με το yield να πηγαίνει στην πλατφόρμα,
- ρυθμίσεις ανά token (whitelist, ελάχιστο fee, ελάχιστο job, επιβάρυνση, vault) που αλλάζει ο owner,
- `owner`, `treasury`, `pause`, και ένα `exitVault` για έκτακτη ανάγκη.

**Εκτός v2:** upgradeability (νέο deployment, τα jobs του v1 μένουν στο παλιό contract), πολλαπλοί arbiters, yield σε EURC (η ρύθμιση υπάρχει, κλειστή), cashback ή έκπτωση.

## 2. Κανόνες τιμολόγησης

Ο owner ορίζει ένα `feeBps` για όλα (25, με σκληρό όριο στον κώδικα `MAX_FEE_BPS = 100`) και ένα `TokenConfig` ανά token:

| Πεδίο | Τι κάνει | Τιμές στο launch |
|---|---|---|
| `enabled` | Το token γίνεται δεκτό. Μόνο whitelist, όχι οποιοδήποτε ERC-20 | ETH, USDC, EURC |
| `minFee` | Ελάχιστο fee ανά job, σε base units του token | ≈ €40 |
| `minJob` | Ελάχιστο συνολικό ποσό job | ≈ €2.000 |
| `surchargeBps` | Τι πληρώνει ο payer όταν το job **δεν** μπαίνει σε vault. Όριο `MAX_SURCHARGE_BPS = 100` | 25 |
| `vault` | ERC-4626 vault. `0` σημαίνει ότι δεν υπάρχει yield για το token | USDC: mock (testnet). EURC, ETH: `0` |

Έλεγχοι στον setter: `minFee × 20 ≤ minJob` (το floor δεν ξεπερνά το 5% του μικρότερου job), το ETH δεν παίρνει vault, και αλλαγή vault μόνο όταν δεν υπάρχουν ενεργά jobs μέσα του (αλλιώς μέσω `exitVault`, παράγραφος 6).

**Στιγμιότυπο στη δημιουργία.** Το `createJob` αποθηκεύει στο job το `total`, το `fee`, το `surchargeBps` και το `yield`. Αλλαγές του owner μετά δεν αγγίζουν υπάρχοντα jobs. Ο payer και ο payee βλέπουν από την αρχή τι θα πληρώσουν.

**Τύποι** (όλα σε base units, στρογγυλοποίηση προς τα κάτω):

```
fee job            = max(minFee, ⌊total × feeBps / 10 000⌋)
fee milestone i    = ⌊fee job × amount_i / total⌋            αφαιρείται από την πληρωμή
επιβάρυνση i       = ⌊amount_i × surchargeBps / 10 000⌋      εισπράττεται στη χρηματοδότηση
(surchargeBps του job = 0 όταν το job μπαίνει σε vault)
```

Το floor ισχύει **ανά job** και μοιράζεται αναλογικά στα milestones. Αν ίσχυε ανά milestone, ένα job €2.000 με 20 milestones των €100 θα πλήρωνε €800 fee. Συνέπεια: ένα milestone που επιστρέφεται δεν χρεώνει το μερίδιό του, άρα η πλατφόρμα μπορεί να πάρει λιγότερο από το floor σε job με refund. Η στρογγυλοποίηση προς τα κάτω αφήνει `dust` (μερικά base units) στον payee.

| Job | Milestones | `fee job` | Fee ανά milestone | Επιβάρυνση, αν δεν τοκίζεται |
|---|---|---|---|---|
| €2.000 | 1.000 + 1.000 | max(40, 5) = 40 | 20 + 20 | 2,5 + 2,5 |
| €20.000 | 12.000 + 8.000 | max(40, 50) = 50 | 30 + 20 | 30 + 20 |
| €100.000 | 100.000 | max(40, 250) = 250 | 250 | 250 |

Στο €20.000 με αρνημένο yield ο payer πληρώνει 50, ο payee 50, σύνολο 0,5%. Αν το δεύτερο milestone επιστραφεί, η πλατφόρμα παίρνει 30 (fee του πρώτου) + 50 (επιβάρυνση, δεν επιστρέφεται) = 80.

**Το contract δεν ξέρει "€".** Οι `minFee` και `minJob` είναι τιμές που βάζει ο owner σε base units (π.χ. 40 EURC = `40e6`, ≈ 43,5 USDC = `43.5e6`). Για το ETH η τιμή είναι χειροκίνητη και πρέπει να ενημερώνεται όταν αλλάζει η τιμή του. Το όριο `minFee × 20 ≤ minJob` περιορίζει τη ζημιά αν μείνει πίσω.

## 3. Ρόλοι

| Ρόλος | Ορίζεται | Μπορεί |
|---|---|---|
| `owner` | constructor, μεταφορά σε δύο βήματα (`transferOwnership` + `acceptOwnership`) | `configureToken`, `setFeeBps`, `setTreasury`, `setPaused`, `exitVault`. **Δεν** έχει συνάρτηση που κινεί κεφάλαιο μερών |
| `treasury` | owner | Παραλήπτης των fees. Η `withdrawFees` είναι ανοιχτή σε όλους και στέλνει μόνο εκεί |
| `arbiter` | constructor, immutable (όπως τώρα) | `resolve` |
| `payer` | `createJob` | `fundMilestone`, `approve`, `dispute`, `refundExpired`, `setVerifier` |
| `payee` | `createJob` | `submitWork`, `claimAfterTimeout` |
| `verifier` | ανά job, προαιρετικό, από τον payer | **Μόνο** `approve` σε milestone που είναι `Submitted` |

Το `verifier` δεν μπορεί να στείλει χρήματα πουθενά αλλού: το `approve` πληρώνει πάντα τον payee του job. Μια διαρροή του κλειδιού του στην χειρότερη περίπτωση ελευθερώνει νωρίτερα δουλειά που ο payee έχει ήδη παραδώσει. Ο payer το ανακαλεί με `setVerifier(id, 0)` οποιαδήποτε στιγμή. Δεν επιτρέπεται `verifier == payee`.

## 4. State

**`Job`** (τα νέα πεδία μπαίνουν στο τέλος, ώστε οι θέσεις των πρώτων τεσσάρων να μείνουν ίδιες, γιατί το `server/index.mjs:346` διαβάζει το `jobs` με θέση):

| Πεδίο | Νέο; | Σημείωση |
|---|---|---|
| `payer`, `payee`, `token`, `description` | όχι | Τα δύο πρώτα λέγονταν `client` και `freelancer` (απόφαση, παράγραφος 11) |
| `verifier` | ναι | `address(0)` = χωρίς auto-approval |
| `total`, `fee` | ναι | Στιγμιότυπο των τύπων |
| `surchargeBps`, `yield` | ναι | `yield` σημαίνει ότι τα milestones του job μπαίνουν στο vault του token |

**`Milestone`**: προστίθεται `epoch` (`uint16`). Το `0` σημαίνει ότι τα χρήματά του είναι idle, αλλιώς το `vaultEpoch` του token τη στιγμή της κατάθεσης.

**Ανά token:** `activeTotal` (κεφάλαιο μερών σε ενεργά milestones), `vaultDue` (το μέρος του που είναι στο τρέχον vault), `accruedFees`, `vaultEpoch`.

**Γενικά:** `owner`, `pendingOwner`, `treasury`, `feeBps`, `paused`.

## 5. Συναρτήσεις

| Συνάρτηση | Ποιος | Αλλαγή |
|---|---|---|
| `createJob(payee, token, description, items, opts)` | payer | Το `opts` είναι struct `{verifier, useYield, fundNow}` (μέχρι το βήμα 2 έχει `{verifier, fundNow}`, το `useYield` έρχεται στο βήμα 3). Ελέγχει whitelist, `total ≥ minJob`, `useYield` μόνο αν το token έχει vault, `verifier ≠ payee`. Αν `fundNow`, εισπράττει `total + Σ επιβαρύνσεις` |
| `fundMilestone(id, m)` | payer | Εισπράττει `amount + επιβάρυνση`. Για ETH το `msg.value` είναι το σύνολο |
| `approve(id, m)` | payer ή verifier | Όπως τώρα, με fee στο `_pay`. Πληρώνει πάντα τον payee |
| `claimAfterTimeout`, `resolve(true)` | payee, arbiter | Όπως τώρα, με fee στο `_pay` |
| `refundExpired`, `resolve(false)` | payer, arbiter | Επιστρέφουν `amount` ολόκληρο. Η επιβάρυνση μένει στην πλατφόρμα |
| `setVerifier(id, v)` | payer | Νέα. Ανά πάσα στιγμή, και για milestones που είναι ήδη `Submitted`. Το `v = 0` τον αφαιρεί. Δεν επιτρέπεται `v == payee`. Δεν υπάρχει όριο όταν κλείσουν όλα τα milestones, γιατί τότε δεν υπάρχει τίποτα να εγκρίνει |
| `quote(token, amounts[], useYield)` | κανείς (view) | Νέα. Επιστρέφει `total`, `fee job` και `συνολική επιβάρυνση` με τους ίδιους τύπους. Το frontend και ο server τη χρησιμοποιούν, ώστε ο υπολογισμός να υπάρχει σε ένα μέρος |
| `configureToken(token, cfg)` | owner | Νέα. Ένα atomic call ώστε να αλλάζουν μαζί `vault` και `surchargeBps` |
| `setFeeBps`, `setTreasury`, `setPaused` | owner | Νέες. Το `setPaused(true)` μπλοκάρει μόνο `createJob` και `fundMilestone`. Πληρωμές και refunds δουλεύουν πάντα |
| `withdrawFees(token)` | όλοι | Νέα. Στέλνει στο `treasury` το `accruedFees`, μόνο αν το idle υπόλοιπο μένει μεγαλύτερο από το κεφάλαιο μερών που πρέπει να είναι idle |
| `harvest(token)` | όλοι | Νέα. Βγάζει το yield από το vault στα `accruedFees` |
| `exitVault(token)` | owner | Νέα. Έκτακτη έξοδος, παράγραφος 6 |

Οι συναρτήσεις που κινούν χρήματα (`createJob`, `fundMilestone`, `approve`, `claimAfterTimeout`, `resolve`, `refundExpired`, `withdrawFees`) παίρνουν απλό reentrancy guard, γιατί στέλνουν ETH ή καλούν tokens και αργότερα vault. Οι `submitWork` και `dispute` δεν κάνουν εξωτερικές κλήσεις και δεν το χρειάζονται. Το πρότυπο checks-effects-interactions του τωρινού κώδικα (status πριν το `_send`) μένει.

## 6. Vault και yield

Το vault μιλάει το interface ERC-4626, ώστε να αλλάζει χωρίς αλλαγή στο contract (mock τώρα, Aave ή άλλο αργότερα). Ένα job που αρνήθηκε το yield **δεν αγγίζει ποτέ το vault**: τα χρήματά του μένουν idle και ισχύει `idle ≥ activeTotal − vaultDue + accruedFees`.

**Ροές**
- **Χρηματοδότηση milestone σε job με `yield`:** εισπράττεται `amount`, κατατίθεται στο vault, `ms.epoch = vaultEpoch`, `vaultDue += amount`, `activeTotal += amount`. Μετά την κατάθεση ελέγχεται ότι τα assets του contract στο vault ανέβηκαν τουλάχιστον κατά `amount − 2` base units, αλλιώς revert.
- **Πληρωμή ή refund:** αν `ms.epoch != 0` και `ms.epoch == vaultEpoch`, γίνεται `vault.withdraw(amount, this, this)` (ακριβές ποσό εξόδου, όπως ορίζει το ERC-4626), `vaultDue -= amount`. Αλλιώς πληρώνεται από idle. Μετά στέλνεται το ποσό, με το fee αφαιρεμένο στην πληρωμή.
- **`harvest`:** `επιπλέον = vaultAssets − vaultDue − margin`. Αν είναι θετικό, βγαίνει από το vault και προστίθεται στα `accruedFees`. Το `margin` (λίγα base units) αφήνει χώρο για στρογγυλοποίηση στο burn των shares, ώστε η τελευταία ανάληψη να μην αποτυγχάνει.
- **`exitVault`:** κάνει `redeem` όλα τα shares στο idle, αυξάνει το `vaultEpoch`, μηδενίζει `vaultDue`, και θέτει `vault = 0` (το yield κλείνει για το token). Τα milestones που ήταν μέσα έχουν παλιό epoch και πληρώνονται πλέον από idle. Το vault μπορεί να ξαναρυθμιστεί αργότερα με `configureToken`, χωρίς να μπερδευτούν τα παλιά milestones.

**Απώλεια στο vault.** Αν το vault χάσει αξία, το κεφάλαιο μερών δεν καλύπτεται πλήρως. Στο v2:
- τα `accruedFees` που δεν έχουν αποσυρθεί απορροφούν πρώτα την απώλεια (το υπόλοιπο του contract είναι κοινό), και η `withdrawFees` σταματά όταν το idle δεν αρκεί,
- υπάρχει view `shortfall(token)`,
- αυτόματο haircut στα μέρη **δεν** υπάρχει. Ποιος καλύπτει το υπόλοιπο είναι απόφαση πριν από mainnet (νομικά, ασφάλιση). Δες ανοιχτά.

**Ρευστότητα.** Το Aave μπορεί να μην έχει διαθέσιμα USDC τη στιγμή της ανάληψης. Τότε η πληρωμή κάνει revert και ξαναδοκιμάζεται, χωρίς να χαθεί τίποτα. Το `exitVault` είναι το σχέδιο διαφυγής. Ρευστό buffer (ένα μέρος να μένει idle) **δεν** μπαίνει στο v2: προσθέτει λογική sweep και δεν αλλάζει το testnet. Αναφέρθηκε στο business plan, οπότε η παράλειψη είναι συνειδητή.

**Mock vault** (`contracts/mocks/MockVault.sol`): υλοποιεί το υποσύνολο του ERC-4626 που χρησιμοποιεί το contract και έχει hooks για tests και demo:
- `accrueYield(amount)`: μεγαλώνει την αξία των shares (μπαίνουν assets από το mintable `MockERC20`),
- `setRatePerYear(bps)`: συσσώρευση με τον χρόνο, ώστε το demo να δείχνει yield που μεγαλώνει,
- `simulateLoss(amount)`: για τα tests απώλειας,
- `setLiquidity(max)`: ποσό που επιτρέπεται να αναληφθεί, για τα tests ρευστότητας.

Στο Base Sepolia τα USDC της Circle δεν είναι mintable, άρα το demo με yield χρειάζεται δικό μας `MockERC20` ως "USDC". Το frontend το υποστηρίζει ήδη με `VITE_USDC_ADDRESS` (`src/lib/tokens.ts`). Δεν θα δείξει πραγματική συμπεριφορά Aave. Ο adapter για Aave δεν σχεδιάζεται εδώ: εξαρτάται από το τι υπάρχει στο Base, και δεν το έχω ελέγξει.

## 7. Edge cases και ασφάλεια

| Θέμα | Χειρισμός |
|---|---|
| Owner αλλάζει fees | Μόνο για νέα jobs (στιγμιότυπο). Σκληρά όρια 1% σε fee και επιβάρυνση |
| Owner παίρνει κεφάλαιο μερών | Καμία συνάρτηση δεν το επιτρέπει. `withdrawFees` ελέγχει φερεγγυότητα, `exitVault` μόνο μετακινεί από vault σε contract |
| Token με fee-on-transfer | Απορρίπτεται όπως τώρα (έλεγχος υπολοίπου πριν/μετά), πλέον στο `amount + επιβάρυνση` |
| ETH | Χωρίς vault. `msg.value` πρέπει να είναι ακριβώς `amount + επιβάρυνση` |
| Μερική χρηματοδότηση | Κάθε milestone πληρώνει επιβάρυνση όταν χρηματοδοτείται, με το ποσοστό του στιγμιότυπου |
| Verifier και dispute | Το `approve` του verifier απαιτεί `Submitted`. Αν ο payer κάνει πρώτα `dispute`, το `approve` κάνει revert. Αν ο verifier προλάβει, ο payer δεν προλαβαίνει `dispute`. Είναι αναγκαίο για auto-release, και ο payer το αποδέχεται όταν ορίζει verifier |
| Αρνητικό αποτέλεσμα ελέγχου | Δεν υπάρχει on-chain "reject". Αν ο έλεγχος αποτύχει, ο payer πρέπει να κάνει `dispute` μέσα στο review period, αλλιώς ο payee μπορεί να πάρει πληρωμή με `claimAfterTimeout`. Ο server πρέπει να ειδοποιεί τον payer |
| Στρογγυλοποίηση | Fee προς τα κάτω, επιβάρυνση προς τα κάτω. Το `dust` πηγαίνει στον payee, κάτω από 20 base units ανά job |
| Δεκαδικά | `minFee`, `minJob` σε base units του κάθε token (6 για USDC και EURC, 18 για ETH) |
| Εξουσίες owner | Στο testnet ένα EOA. Πριν από mainnet πολυυπογραφικό (multisig) |

## 8. Επιπτώσεις στα υπόλοιπα

**ABI.** Αλλάζουν οι υπογραφές `createJob`, `getJob`, και τα events. Το `npm run compile` ξαναγράφει το `abi/FreelanceEscrow.json`.

**Events.**
- `JobCreated`: προστίθενται `fee`, `surchargeBps`, `verifier` (και `yield` στο βήμα 3).
- `MilestoneFunded`: προστίθεται `surcharge`.
- `MilestonePaid(id, milestone, payee, gross, fee)`: νέο, εκπέμπεται σε κάθε πληρωμή (`approve`, `claimAfterTimeout`, `resolve`). Τα υπάρχοντα `Approved` και `Resolved` μένουν, γιατί το `useJobTrace` τα χρησιμοποιεί για να βρει πώς απελευθερώθηκε μια πληρωμή.
- νέα στο βήμα 1: `FeesWithdrawn`, `TokenConfigured`, `FeeBpsSet`, `TreasurySet`, `PausedSet`, `OwnershipTransferStarted`, `OwnershipTransferred`. στο βήμα 2: `VerifierSet(id, verifier)`. Αργότερα: `YieldHarvested`, `VaultExited`. Το `Approved` δεν λέει ποιος ενέκρινε, φαίνεται από τον αποστολέα της συναλλαγής.

**Frontend**
- `HireForm`: πεδίο verifier (προεπιλογή η διεύθυνση του verifier της πλατφόρμας, με επιλογή "χωρίς"), επιλογή yield με προεπιλογή ενεργό για USDC και "αρνούμαι το yield (+0,25%)", ζωντανή εμφάνιση του fee και της επιβάρυνσης από το `quote`. Για ETH το value γίνεται `amount + επιβάρυνση`.
- `JobActions`: το `fundMilestone` και το `ensureAllowance` στο `amount + επιβάρυνση`.
- `useFiatFunding` και ο server (`pipeline.mjs`): νέα υπογραφή `createJob`, και το ποσό του SEPA εμβάσματος πρέπει να καλύπτει την επιβάρυνση, αφού το EURC δεν τοκίζεται.
- `src/lib/jobs.ts` (`RawJob`, `jobFromChain`): τα νέα πεδία.
- Απόδειξη (`ReceiptPage`): ακαθάριστο ποσό, fee πλατφόρμας, καθαρό στον payee, από το `MilestonePaid`.
- `MilestoneDetails` και ροή job: ένδειξη "τοκίζεται ή όχι" και fee ορατό στον payee **πριν** το `submitWork`.

**Server.** Το `server/index.mjs:346` διαβάζει τα πρώτα δύο πεδία του `jobs` και δεν επηρεάζεται, αν τα νέα πεδία μπουν στο τέλος. Η υπηρεσία verifier (GitHub webhook που καλεί `approve` από το κλειδί του verifier) είναι ξεχωριστό design, μετά το contract. Το contract τής δίνει μόνο το `WorkSubmitted` ως trigger και το `deliverable` ως string με τον σύνδεσμο PR ή ticket.

**Deploy.** Το `scripts/deploy.cjs` παίρνει `(owner, arbiter, treasury, reviewPeriod)` και μετά καλεί `configureToken` για κάθε token. Στο mainnet το USDC μένει με `vault = 0` μέχρι να υπάρξει νομική γνώμη. Αυτή είναι η πύλη, όχι ο κώδικας. Τα jobs του v1 δεν μεταφέρονται: το frontend δείχνει μόνο το νέο contract.

## 9. Σχέδιο tests (Hardhat)

Τα υπάρχοντα `test/FreelanceEscrow.cjs` και `test/FreelanceEscrowToken.cjs` αλλάζουν: νέα args στον constructor, ρύθμιση token και `minJob` σε helper, καθαρό ποσό αντί για ακαθάριστο. Το `scripts/test-flow.mjs` τρέχει end-to-end και θέλει το ίδιο.

- **Τιμολόγηση:** crossover floor και ποσοστού (€16.000 με minFee €40), αναλογικό fee ανά milestone, `dust`, επιβάρυνση ανά milestone, ETH και token, ακριβές `msg.value`, job κάτω από `minJob`, token εκτός whitelist.
- **Refund:** χωρίς fee payee, η επιβάρυνση μένει, ισχύει και στο `refundExpired` και στο `resolve(false)`.
- **Στιγμιότυπο:** αλλαγή `feeBps`, `surchargeBps`, `minFee` μετά το `createJob` δεν αλλάζει το job.
- **Όρια:** `feeBps` και `surchargeBps` πάνω από 100 απορρίπτονται, `minFee × 20 > minJob` απορρίπτεται, ETH με vault απορρίπτεται.
- **Verifier:** εγκρίνει `Submitted`, όχι `Funded` ή `Disputed`, ο payer ανακαλεί, τρίτος αποτυγχάνει, `verifier == payee` απορρίπτεται.
- **Ρόλοι και ασφάλεια:** owner σε δύο βήματα, `pause` μπλοκάρει μόνο δημιουργία και χρηματοδότηση, `withdrawFees` δεν αφήνει το idle κάτω από τα κεφάλαια μερών, reentrancy από ETH παραλήπτη και από κακό vault.
- **Vault:** job με αρνημένο yield δεν αγγίζει το vault (υπόλοιπο του vault ίδιο), job με yield καταθέτει στη χρηματοδότηση και αναλαμβάνει στην πληρωμή, `harvest` με θετικό και με μηδενικό yield, η τελευταία ανάληψη περνά μετά το `harvest` (margin), απώλεια (`shortfall`, `withdrawFees` σταματά), ρευστότητα (`setLiquidity` κάνει την πληρωμή revert και ξαναπερνά), `exitVault` με milestones μέσα και νέο vault αμέσως μετά.
- **Αναλλοίωτα με τυχαίες κλήσεις:** μετά από κάθε κλήση, `idle + vaultAssets ≥ activeTotal + accruedFees` (χωρίς απώλεια) και `Σ εισπράξεις = Σ πληρωμές + Σ refunds + Σ fees + υπόλοιπο`.

## 10. Σειρά υλοποίησης

Ένα deployment, αλλά η δουλειά σε βήματα, με tests σε κάθε βήμα:
1. `owner`, whitelist, `TokenConfig`, fee payee, επιβάρυνση, `quote`, `MilestonePaid`, μετονομασία σε `payer`/`payee`. **Έγινε** (2026-10-28, branch `contract-v2`, δεν έχει γίνει commit). Μένει εκτός το `abi/` και το frontend, δες το βήμα 4.
2. `verifier` και `setVerifier`. **Έγινε** (2026-10-28, branch `contract-v2`, δεν έχει γίνει commit). Το `JobOptions` έχει `verifier` πριν από το `fundNow`, το `Job` έχει `verifier` στο τέλος, και υπάρχει το σφάλμα `BadVerifier`.
3. Vault, `MockVault`, `harvest`, `exitVault`, `withdrawFees`.
4. ABI, frontend, server, deploy script.
5. Audit πριν από πραγματικά κεφάλαια.

## 11. Αποφάσεις και ανοιχτά

**Αποφασίστηκαν (2026-10-28):**
1. **Floor ανά job, αναλογικά στα milestones** (παράγραφος 2). Σε job με refund η πλατφόρμα μπορεί να πάρει κάτω από το floor.
2. **Whitelist tokens.** Το v2 δέχεται μόνο όσα ρυθμίσει ο owner.
3. **Μετονομασία `client`/`freelancer` σε `payer`/`payee` στο contract.**
4. **Verifier που προλαβαίνει το dispute του payer** (παράγραφος 7): αποδεκτό, με ευδιάκριτο μήνυμα όταν ο payer ορίζει verifier.

**Ανοιχτά** (δεν μπλοκάρουν το testnet):
- **Απώλεια στο vault:** ποιος την καλύπτει πέρα από τα fees της πλατφόρμας (παράγραφος 6). Μπλοκάρει το mainnet.
- **Χωρίς buffer ρευστότητας στο v2** (παράγραφος 6). Πρόταση: ναι, να ξαναδούμε με το Aave.
- **Owner:** EOA στο testnet, multisig πριν από mainnet.
