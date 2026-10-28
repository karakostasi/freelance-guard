const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { REVIEW, item, opts, rules, deploy } = require("./helpers.cjs");

const U = (n) => BigInt(n) * 10n ** 6n; // 6 decimals, like EURC and USDC

// The escrow mechanics for ERC-20 jobs, with the fees switched off so every amount is exact.
describe("FreelanceEscrow (ERC-20)", () => {
  let escrow, token, payer, payee, arbiter, other, escrowAddr;

  beforeEach(async () => {
    token = await ethers.deployContract("MockERC20", ["Mock EURC", "EURC", 6]);
    ({ escrow, payer, payee, arbiter, other } = await deploy({ tokens: [await token.getAddress()] }));
    escrowAddr = await escrow.getAddress();
    await token.mint(payer.address, U(10_000));
  });

  const create = async (items, fundNow, approve = 0n, tok = token) => {
    if (approve > 0n) await tok.connect(payer).approve(escrowAddr, approve);
    return escrow.connect(payer).createJob(payee.address, await tok.getAddress(), "ipfs://spec", items, opts({ fundNow }));
  };

  it("pulls the whole total in one transfer when funding now", async () => {
    await create([item("a", U(300)), item("b", U(200))], true, U(500));
    expect(await token.balanceOf(escrowAddr)).to.equal(U(500));
    const [job, ms] = await escrow.getJob(1);
    expect(job.token).to.equal(await token.getAddress());
    expect(ms.map((m) => m.status)).to.deep.equal([1n, 1n]);
  });

  it("pays each milestone to the payee in tokens", async () => {
    await create([item("a", U(300)), item("b", U(200))], true, U(500));
    await escrow.connect(payee).submitWork(1, 0, "x");
    await escrow.connect(payer).approve(1, 0);
    expect(await token.balanceOf(payee.address)).to.equal(U(300));
    expect(await token.balanceOf(escrowAddr)).to.equal(U(200));
    await expect(escrow.connect(payer).approve(1, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
  });

  it("funds milestones one by one, pulling only that milestone", async () => {
    await create([item("a", U(300)), item("b", U(200))], false);
    expect(await token.balanceOf(escrowAddr)).to.equal(0n);
    await token.connect(payer).approve(escrowAddr, U(300));
    await escrow.connect(payer).fundMilestone(1, 0);
    expect(await token.balanceOf(escrowAddr)).to.equal(U(300));
    expect((await escrow.getJob(1))[1].map((m) => m.status)).to.deep.equal([1n, 0n]);
  });

  it("lets the payee claim, the payer refund and the arbiter resolve in tokens", async () => {
    await create([item("claim", U(100)), item("refund", U(100), 1), item("dispute", U(100))], true, U(300));
    await escrow.connect(payee).submitWork(1, 0, "x");
    await escrow.connect(payee).submitWork(1, 2, "z");
    await escrow.connect(payer).dispute(1, 2);
    await time.increase(REVIEW);
    await escrow.connect(payee).claimAfterTimeout(1, 0);
    expect(await token.balanceOf(payee.address)).to.equal(U(100));
    const before = await token.balanceOf(payer.address);
    await escrow.connect(payer).refundExpired(1, 1);
    await escrow.connect(arbiter).resolve(1, 2, false);
    expect(await token.balanceOf(payer.address)).to.equal(before + U(200));
    expect(await token.balanceOf(escrowAddr)).to.equal(0n);
  });

  it("reverts without an allowance and creates nothing", async () => {
    await expect(create([item("a", U(100))], true, 0n)).to.be.revertedWithCustomError(escrow, "TransferFailed");
    expect(await escrow.jobCount()).to.equal(0n);
    await create([item("a", U(100))], false);
    await expect(escrow.connect(payer).fundMilestone(1, 0)).to.be.revertedWithCustomError(escrow, "TransferFailed");
  });

  it("does not accept ETH for a token job", async () => {
    const t = await token.getAddress();
    await token.connect(payer).approve(escrowAddr, U(100));
    await expect(escrow.connect(payer).createJob(payee.address, t, "x", [item("a", U(100))], opts({ fundNow: true }), { value: 1n })).to.be.revertedWith("no ETH expected");
  });

  it("rejects tokens that are not enabled, non-contracts and fee-on-transfer tokens", async () => {
    const make = (t, fundNow = true) => escrow.connect(payer).createJob(payee.address, t, "x", [item("a", U(100))], opts({ fundNow }));
    await expect(make(other.address)).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
    await expect(escrow.configureToken(other.address, rules())).to.be.revertedWithCustomError(escrow, "BadConfig");

    const fee = await ethers.deployContract("MockFeeToken");
    const feeAddr = await fee.getAddress();
    await expect(make(feeAddr)).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
    await escrow.configureToken(feeAddr, rules());
    await fee.mint(payer.address, U(500));
    await fee.connect(payer).approve(escrowAddr, U(500));
    await expect(make(feeAddr)).to.be.revertedWith("unsupported token");
    await make(feeAddr, false);
    await expect(escrow.connect(payer).fundMilestone(1, 0)).to.be.revertedWith("unsupported token");
  });
});
