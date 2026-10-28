const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { REVIEW, DAY, item, opts, rules, deploy } = require("./helpers.cjs");

const U = (n) => ethers.parseUnits(String(n), 6); // USDC and EURC have 6 decimals
const E = (n) => ethers.parseEther(String(n));

// The launch rules: payee fee max(40, 0.25%), payer surcharge 0.25%, smallest job 2,000 (all in USDC here).
describe("FreelanceEscrow fees", () => {
  let escrow, owner, payer, payee, arbiter, other, treasury, verifier, usdc, usdcAddr, escrowAddr;

  beforeEach(async () => {
    ({ escrow, owner, payer, payee, arbiter, other, treasury } = await deploy({ free: false }));
    escrowAddr = await escrow.getAddress();
    [, , , , , , verifier] = await ethers.getSigners();
    usdc = await ethers.deployContract("MockERC20", ["Mock USDC", "USDC", 6]);
    usdcAddr = await usdc.getAddress();
    await escrow.configureToken(usdcAddr, rules({ surchargeBps: 25, minFee: U(40), minJob: U(2000) }));
    await usdc.mint(payer.address, U(1_000_000));
    await usdc.connect(payer).approve(escrowAddr, ethers.MaxUint256);
  });

  const create = (items, fundNow = true, from = payer) =>
    escrow.connect(from).createJob(payee.address, usdcAddr, "ipfs://spec", items, opts({ fundNow }));
  const deliver = async (id, m) => escrow.connect(payee).submitWork(id, m, "x");

  describe("quote", () => {
    // [milestones, total, fee, surcharge]
    const cases = [
      [[1000, 1000], 2000, 40, 5],
      [[12000, 8000], 20000, 50, 50],
      [[100000], 100000, 250, 250],
      [[16000], 16000, 40, 40], // where 0.25% overtakes the 40 minimum
      [[16400], 16400, 41, 41],
    ];
    for (const [amounts, total, fee, surcharge] of cases) {
      it(`prices a job of ${total}`, async () => {
        const q = await escrow.quote(usdcAddr, amounts.map(U));
        expect([q.total, q.fee, q.surcharge]).to.deep.equal([U(total), U(fee), U(surcharge)]);
      });
    }

    it("does not quote a token that is not enabled", async () => {
      await expect(escrow.quote(other.address, [1n])).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
    });
  });

  describe("funding", () => {
    it("takes the amounts plus the surcharge when funding now, and records the terms", async () => {
      await expect(create([item("a", U(12000)), item("b", U(8000))]))
        .to.emit(escrow, "JobCreated")
        .withArgs(1, payer.address, payee.address, usdcAddr, U(20000), 2, U(50), 25, ethers.ZeroAddress)
        .and.to.emit(escrow, "MilestoneFunded");
      expect(await usdc.balanceOf(escrowAddr)).to.equal(U(20050));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(50));
      expect(await escrow.activeTotal(usdcAddr)).to.equal(U(20000));
      const job = await escrow.jobs(1);
      expect([job.total, job.fee, job.surchargeBps]).to.deep.equal([U(20000), U(50), 25n]);
    });

    it("takes the surcharge milestone by milestone when funding one by one", async () => {
      await create([item("a", U(12000)), item("b", U(8000))], false);
      expect(await usdc.balanceOf(escrowAddr)).to.equal(0n);
      await expect(escrow.connect(payer).fundMilestone(1, 0)).to.emit(escrow, "MilestoneFunded").withArgs(1, 0, U(12000), U(30), anyValue);
      expect(await usdc.balanceOf(escrowAddr)).to.equal(U(12030));
      await escrow.connect(payer).fundMilestone(1, 1);
      expect(await usdc.balanceOf(escrowAddr)).to.equal(U(20050));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(50));
    });

    it("rejects a job that is too small or in a token that is not enabled", async () => {
      await expect(create([item("a", U(1999))])).to.be.revertedWithCustomError(escrow, "JobTooSmall");
      await create([item("a", U(2000))]);
      const other20 = await ethers.deployContract("MockERC20", ["Other", "OTH", 6]);
      await expect(escrow.connect(payer).createJob(payee.address, await other20.getAddress(), "x", [item("a", U(5000))], opts({ fundNow: true }))).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
    });
  });

  describe("payment", () => {
    beforeEach(async () => {
      await create([item("a", U(12000)), item("b", U(8000))]);
    });

    it("takes each milestone's share of the job fee from the payee", async () => {
      await deliver(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.emit(escrow, "MilestonePaid").withArgs(1, 0, payee.address, U(12000), U(30));
      expect(await usdc.balanceOf(payee.address)).to.equal(U(11970));
      await deliver(1, 1);
      await expect(escrow.connect(payer).approve(1, 1)).to.emit(escrow, "MilestonePaid").withArgs(1, 1, payee.address, U(8000), U(20));
      expect(await usdc.balanceOf(payee.address)).to.equal(U(11970 + 7980));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(100)); // 50 surcharge + 50 fee: 0.5% of the job
      expect(await escrow.activeTotal(usdcAddr)).to.equal(0n);
      expect(await usdc.balanceOf(escrowAddr)).to.equal(U(100));
    });

    it("takes the fee when the payee claims after the review period and when the arbiter rules for the payee", async () => {
      await deliver(1, 0);
      await deliver(1, 1);
      await escrow.connect(payer).dispute(1, 1);
      await time.increase(REVIEW);
      await escrow.connect(payee).claimAfterTimeout(1, 0);
      expect(await usdc.balanceOf(payee.address)).to.equal(U(11970));
      await escrow.connect(arbiter).resolve(1, 1, true);
      expect(await usdc.balanceOf(payee.address)).to.equal(U(11970 + 7980));
    });

    it("takes no fee on a refund, and the payer's surcharge is not returned", async () => {
      await deliver(1, 0);
      await escrow.connect(payer).approve(1, 0);
      const before = await usdc.balanceOf(payer.address);
      await time.increase(8 * DAY);
      await escrow.connect(payer).refundExpired(1, 1);
      expect(await usdc.balanceOf(payer.address)).to.equal(before + U(8000));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(80)); // 50 surcharge + the 30 fee of the paid milestone
      expect(await usdc.balanceOf(escrowAddr)).to.equal(U(80));
    });

    it("takes no fee when the arbiter refunds", async () => {
      await deliver(1, 0);
      await escrow.connect(payer).dispute(1, 0);
      const before = await usdc.balanceOf(payer.address);
      await escrow.connect(arbiter).resolve(1, 0, false);
      expect(await usdc.balanceOf(payer.address)).to.equal(before + U(12000));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(50)); // only the surcharge
    });

    it("keeps the dust of the rounding with the payee", async () => {
      await create([item("a", U(1000) + 1n), item("b", U(1000) - 1n)]);
      await deliver(2, 0);
      await deliver(2, 1);
      const fees = [];
      for (const m of [0, 1]) {
        const tx = await escrow.connect(payer).approve(2, m);
        const [log] = (await tx.wait()).logs.map((l) => escrow.interface.parseLog(l)).filter((l) => l?.name === "MilestonePaid");
        fees.push(log.args.fee);
      }
      expect(fees[0] + fees[1]).to.equal(U(40) - 1n); // 20 and 19.999999: one unit short of the job fee, never over
    });
  });

  describe("the terms are fixed when the job is created", () => {
    it("ignores later changes of the fee, the surcharge and the minimum", async () => {
      await create([item("a", U(12000)), item("b", U(8000))], false);
      await escrow.setFeeBps(100);
      await escrow.configureToken(usdcAddr, rules({ surchargeBps: 100, minFee: U(100), minJob: U(2000) }));

      await escrow.connect(payer).fundMilestone(1, 0);
      expect(await usdc.balanceOf(escrowAddr)).to.equal(U(12030)); // still the 0.25% surcharge
      await deliver(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.emit(escrow, "MilestonePaid").withArgs(1, 0, payee.address, U(12000), U(30));

      await create([item("c", U(10000))]); // a new job gets the new terms
      const job = await escrow.jobs(2);
      expect([job.fee, job.surchargeBps]).to.deep.equal([U(100), 100n]);
    });

    it("still settles a job after its token is disabled", async () => {
      await create([item("a", U(5000))]);
      await escrow.configureToken(usdcAddr, rules({ enabled: false }));
      await deliver(1, 0);
      await escrow.connect(payer).approve(1, 0);
      await expect(create([item("b", U(5000))])).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
    });
  });

  describe("settings", () => {
    it("limits what the owner can set", async () => {
      await expect(escrow.setFeeBps(101)).to.be.revertedWithCustomError(escrow, "BadConfig");
      await escrow.setFeeBps(100);
      await expect(escrow.configureToken(usdcAddr, rules({ surchargeBps: 101 }))).to.be.revertedWithCustomError(escrow, "BadConfig");
      // The minimum fee can't be more than 5% of the smallest job.
      await expect(escrow.configureToken(usdcAddr, rules({ minFee: U(101), minJob: U(2000) }))).to.be.revertedWithCustomError(escrow, "BadConfig");
      await escrow.configureToken(usdcAddr, rules({ minFee: U(100), minJob: U(2000) }));
      await expect(escrow.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(escrow, "BadConfig");
    });

    it("lets only the owner change them", async () => {
      await expect(escrow.connect(other).setFeeBps(10)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(other).configureToken(usdcAddr, rules())).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(other).setTreasury(other.address)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(other).setPaused(true)).to.be.revertedWithCustomError(escrow, "NotAllowed");
    });

    it("hands ownership over in two steps", async () => {
      await expect(escrow.connect(other).transferOwnership(other.address)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await escrow.transferOwnership(other.address);
      expect(await escrow.owner()).to.equal(owner.address);
      await expect(escrow.connect(payer).acceptOwnership()).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await escrow.connect(other).acceptOwnership();
      expect(await escrow.owner()).to.equal(other.address);
      expect(await escrow.pendingOwner()).to.equal(ethers.ZeroAddress);
      await expect(escrow.setFeeBps(10)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await escrow.connect(other).setFeeBps(10);
    });

    it("when paused, blocks new jobs and funding but never payments or refunds", async () => {
      await create([item("paid", U(2000)), item("refunded", U(2000), 1)], false);
      await escrow.connect(payer).fundMilestone(1, 0);
      await escrow.connect(payer).fundMilestone(1, 1);
      await escrow.setPaused(true);
      await expect(create([item("a", U(2000))])).to.be.revertedWithCustomError(escrow, "IsPaused");
      await deliver(1, 0);
      await escrow.connect(payer).approve(1, 0);
      await time.increase(2 * DAY);
      await escrow.connect(payer).refundExpired(1, 1);
      await escrow.setPaused(false);
      await create([item("a", U(2000))]);
    });

    it("blocks funding while paused", async () => {
      await create([item("a", U(2000))], false);
      await escrow.setPaused(true);
      await expect(escrow.connect(payer).fundMilestone(1, 0)).to.be.revertedWithCustomError(escrow, "IsPaused");
    });
  });

  describe("withdrawing fees", () => {
    it("sends the earned fees to the treasury, for anyone who asks", async () => {
      await create([item("a", U(12000)), item("b", U(8000))]);
      await expect(escrow.connect(other).withdrawFees(usdcAddr)).to.emit(escrow, "FeesWithdrawn").withArgs(usdcAddr, treasury.address, U(50));
      expect(await usdc.balanceOf(treasury.address)).to.equal(U(50));
      expect(await usdc.balanceOf(escrowAddr)).to.equal(U(20000));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(0n);
      await expect(escrow.withdrawFees(usdcAddr)).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
    });

    it("never touches the money of milestones still in escrow", async () => {
      await create([item("a", U(5000))]);
      await deliver(1, 0);
      await escrow.connect(payer).approve(1, 0);
      await escrow.withdrawFees(usdcAddr);
      expect(await usdc.balanceOf(escrowAddr)).to.equal(0n);
    });

    describe("in ETH", () => {
      beforeEach(async () => {
        await escrow.configureToken(ethers.ZeroAddress, rules({ surchargeBps: 25, minFee: E("0.01"), minJob: E("0.2") }));
      });
      const createEth = (items, value, fundNow = true) => escrow.connect(payer).createJob(payee.address, ethers.ZeroAddress, "x", items, opts({ fundNow }), { value });

      it("charges the surcharge on top of the amount and pays the fee out of the payment", async () => {
        const q = await escrow.quote(ethers.ZeroAddress, [E(1)]);
        expect([q.fee, q.surcharge]).to.deep.equal([E("0.01"), E("0.0025")]);
        await expect(createEth([item("a", E(1))], E(1))).to.be.revertedWith("wrong amount");
        await createEth([item("a", E(1))], E("1.0025"));
        await deliver(1, 0);
        await expect(escrow.connect(payer).approve(1, 0)).to.changeEtherBalance(payee, E("0.99"));
        await expect(escrow.withdrawFees(ethers.ZeroAddress)).to.changeEtherBalance(treasury, E("0.0125"));
      });

      it("refuses to withdraw fees when the balance does not cover the milestones in escrow", async () => {
        await createEth([item("a", E(1))], E("1.0025"));
        await network.provider.send("hardhat_setBalance", [escrowAddr, "0x" + E(1).toString(16)]);
        await expect(escrow.withdrawFees(ethers.ZeroAddress)).to.be.revertedWithCustomError(escrow, "Insolvent");
      });

      it("blocks a payee that calls back into the escrow while being paid", async () => {
        const evil = await ethers.deployContract("ReentrantPayee", [escrowAddr]);
        await escrow.connect(payer).createJob(await evil.getAddress(), ethers.ZeroAddress, "x", [item("a", E(1))], opts({ fundNow: true }), { value: E("1.0025") });
        await evil.submit(1, 0);
        await escrow.connect(payer).approve(1, 0);
        expect(await evil.attempted()).to.equal(true);
        expect(await evil.reentered()).to.equal(false);
        expect(await ethers.provider.getBalance(await evil.getAddress())).to.equal(E("0.99"));
      });
    });
  });

  // Random sequences of calls. After every call the escrow must hold exactly what it owes the payers of milestones
  // still open plus the fees nobody has withdrawn yet, in both ETH and the token.
  describe("accounting", () => {
    it("always holds exactly the open milestones plus the unwithdrawn fees", async () => {
      await escrow.configureToken(ethers.ZeroAddress, rules({ surchargeBps: 25, minFee: E("0.01"), minJob: E("0.2") }));
      // mulberry32, so the run is the same every time. (A plain LCG has low bits that just alternate.)
      let state = 20261028;
      const rnd = (n) => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
      };
      const balanceOf = (token) => (token === ethers.ZeroAddress ? ethers.provider.getBalance(escrowAddr) : usdc.balanceOf(escrowAddr));
      const done = {};
      const attempt = (name, call) => call.then(() => (done[name] = (done[name] ?? 0) + 1), () => {});

      const check = async () => {
        for (const token of [ethers.ZeroAddress, usdcAddr]) {
          const held = await balanceOf(token);
          expect(held).to.equal((await escrow.activeTotal(token)) + (await escrow.accruedFees(token)));
        }
      };
      // The same total, recomputed from the milestones themselves.
      const checkMilestones = async () => {
        const open = { [ethers.ZeroAddress]: 0n, [usdcAddr]: 0n };
        for (let id = 1n; id <= (await escrow.jobCount()); id++) {
          const [job, ms] = await escrow.getJob(id);
          for (const m of ms) if (m.status >= 1n && m.status <= 3n) open[job.token === ethers.ZeroAddress ? ethers.ZeroAddress : usdcAddr] += m.amount;
        }
        expect(await escrow.activeTotal(ethers.ZeroAddress)).to.equal(open[ethers.ZeroAddress]);
        expect(await escrow.activeTotal(usdcAddr)).to.equal(open[usdcAddr]);
      };

      // Every milestone with its status, so a call can aim at a milestone it can actually act on.
      const snapshot = async () => {
        const all = [];
        for (let id = 1n; id <= (await escrow.jobCount()); id++) {
          const [job, ms] = await escrow.getJob(id);
          ms.forEach((m, i) => all.push({ id, m: i, status: Number(m.status), amount: m.amount, job }));
        }
        return all;
      };
      const [UNFUNDED, FUNDED, SUBMITTED, DISPUTED] = [0, 1, 2, 3];

      for (let step = 0; step < 500; step++) {
        const all = await snapshot();
        // Most calls aim at a milestone in the right state. One in ten goes anywhere, to hit the reverts too.
        const target = (...statuses) => {
          const fit = all.filter((x) => statuses.includes(x.status));
          return fit.length > 0 && rnd(10) > 0 ? fit[rnd(fit.length)] : all[rnd(all.length)];
        };
        const op = rnd(11);
        if (op === 0 || all.length === 0) {
          const eth = rnd(2) === 0;
          const items = Array.from({ length: 1 + rnd(3) }, (_, i) => item(`m${i}`, eth ? E(0.1 + rnd(5) / 10) : U(500 + rnd(9000)), 4 + rnd(8)));
          const token = eth ? ethers.ZeroAddress : usdcAddr;
          const fundNow = rnd(2) === 0;
          const q = await escrow.quote(token, items.map((i) => i.amount));
          const who = rnd(2) === 0 ? verifier.address : ethers.ZeroAddress;
          await attempt("createJob", escrow.connect(payer).createJob(payee.address, token, "x", items, opts({ verifier: who, fundNow }), { value: eth && fundNow ? q.total + q.surcharge : 0n }));
        } else if (op === 1) {
          const t = target(UNFUNDED);
          const value = t.job.token === ethers.ZeroAddress ? t.amount + (t.amount * t.job.surchargeBps) / 10000n : 0n;
          await attempt("fundMilestone", escrow.connect(payer).fundMilestone(t.id, t.m, { value }));
        } else if (op === 2 || op === 3) {
          const t = target(FUNDED);
          await attempt("submitWork", escrow.connect(payee).submitWork(t.id, t.m, "x"));
        } else if (op === 4) {
          const t = target(SUBMITTED);
          // Sometimes the verifier approves instead, which only works on jobs that have it.
          const byVerifier = rnd(2) === 0;
          await attempt(byVerifier ? "approveByVerifier" : "approve", escrow.connect(byVerifier ? verifier : payer).approve(t.id, t.m));
        } else if (op === 5) {
          const t = target(SUBMITTED);
          await attempt("dispute", escrow.connect(payer).dispute(t.id, t.m));
        } else if (op === 6) {
          const t = target(DISPUTED);
          await attempt("resolve", escrow.connect(arbiter).resolve(t.id, t.m, rnd(2) === 0));
        } else if (op === 7) {
          const t = target(SUBMITTED);
          await attempt("claimAfterTimeout", escrow.connect(payee).claimAfterTimeout(t.id, t.m));
        } else if (op === 8) {
          const t = target(FUNDED);
          await attempt("refundExpired", escrow.connect(payer).refundExpired(t.id, t.m));
        } else if (op === 9) {
          await attempt("withdrawFees", escrow.withdrawFees(rnd(2) === 0 ? ethers.ZeroAddress : usdcAddr));
        } else {
          await time.increase((1 + rnd(4)) * DAY);
        }
        await check();
        if (step % 10 === 0) await checkMilestones();
      }
      await checkMilestones();
      // The run has to reach every kind of settlement, or the checks above prove nothing.
      for (const name of ["createJob", "fundMilestone", "submitWork", "approve", "approveByVerifier", "dispute", "resolve", "claimAfterTimeout", "refundExpired", "withdrawFees"]) {
        expect(done[name] ?? 0, `${name} never succeeded in the random run`).to.be.greaterThan(0);
      }
    });
  });
});
