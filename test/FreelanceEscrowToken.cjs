const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const REVIEW = 3 * 24 * 3600;
const DAY = 24 * 3600;
const U = (n) => BigInt(n) * 10n ** 6n; // 6 decimals, like EURC and USDC

const item = (title, amount, days = 7) => ({ title, amount, duration: days * DAY });

describe("FreelanceEscrow (ERC-20)", () => {
  let escrow, token, client, freelancer, arbiter, other, escrowAddr;

  beforeEach(async () => {
    [client, freelancer, arbiter, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("FreelanceEscrow", [arbiter.address, REVIEW]);
    escrowAddr = await escrow.getAddress();
    token = await ethers.deployContract("MockERC20", ["Mock EURC", "EURC", 6]);
    await token.mint(client.address, U(10_000));
  });

  const create = async (items, fundNow, approve = 0n, tok = token) => {
    if (approve > 0n) await tok.connect(client).approve(escrowAddr, approve);
    return escrow.connect(client).createJob(freelancer.address, await tok.getAddress(), "ipfs://spec", items, fundNow);
  };

  it("pulls the whole total in one transfer when funding now", async () => {
    await create([item("a", U(300)), item("b", U(200))], true, U(500));
    expect(await token.balanceOf(escrowAddr)).to.equal(U(500));
    const [job, ms] = await escrow.getJob(1);
    expect(job.token).to.equal(await token.getAddress());
    expect(ms.map((m) => m.status)).to.deep.equal([1n, 1n]);
  });

  it("pays each milestone to the freelancer in tokens", async () => {
    await create([item("a", U(300)), item("b", U(200))], true, U(500));
    await escrow.connect(freelancer).submitWork(1, 0, "x");
    await escrow.connect(client).approve(1, 0);
    expect(await token.balanceOf(freelancer.address)).to.equal(U(300));
    expect(await token.balanceOf(escrowAddr)).to.equal(U(200));
    await expect(escrow.connect(client).approve(1, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
  });

  it("funds milestones one by one, pulling only that milestone", async () => {
    await create([item("a", U(300)), item("b", U(200))], false);
    expect(await token.balanceOf(escrowAddr)).to.equal(0n);
    await token.connect(client).approve(escrowAddr, U(300));
    await escrow.connect(client).fundMilestone(1, 0);
    expect(await token.balanceOf(escrowAddr)).to.equal(U(300));
    expect((await escrow.getJob(1))[1].map((m) => m.status)).to.deep.equal([1n, 0n]);
  });

  it("lets the freelancer claim, the client refund and the arbiter resolve in tokens", async () => {
    await create([item("claim", U(100)), item("refund", U(100), 1), item("dispute", U(100))], true, U(300));
    await escrow.connect(freelancer).submitWork(1, 0, "x");
    await escrow.connect(freelancer).submitWork(1, 2, "z");
    await escrow.connect(client).dispute(1, 2);
    await time.increase(REVIEW);
    await escrow.connect(freelancer).claimAfterTimeout(1, 0);
    expect(await token.balanceOf(freelancer.address)).to.equal(U(100));
    const before = await token.balanceOf(client.address);
    await escrow.connect(client).refundExpired(1, 1);
    await escrow.connect(arbiter).resolve(1, 2, false);
    expect(await token.balanceOf(client.address)).to.equal(before + U(200));
    expect(await token.balanceOf(escrowAddr)).to.equal(0n);
  });

  it("reverts without an allowance and creates nothing", async () => {
    await expect(create([item("a", U(100))], true, 0n)).to.be.revertedWithCustomError(escrow, "TransferFailed");
    expect(await escrow.jobCount()).to.equal(0n);
    await create([item("a", U(100))], false);
    await expect(escrow.connect(client).fundMilestone(1, 0)).to.be.revertedWithCustomError(escrow, "TransferFailed");
  });

  it("does not accept ETH for a token job", async () => {
    const t = await token.getAddress();
    await token.connect(client).approve(escrowAddr, U(100));
    await expect(escrow.connect(client).createJob(freelancer.address, t, "x", [item("a", U(100))], true, { value: 1n })).to.be.revertedWith("no ETH expected");
  });

  it("rejects non-contract tokens and fee-on-transfer tokens", async () => {
    await expect(escrow.connect(client).createJob(freelancer.address, other.address, "x", [item("a", U(1))], true)).to.be.revertedWith("bad token");
    const fee = await ethers.deployContract("MockFeeToken");
    await fee.mint(client.address, U(500));
    await fee.connect(client).approve(escrowAddr, U(500));
    await expect(escrow.connect(client).createJob(freelancer.address, await fee.getAddress(), "x", [item("a", U(100))], true)).to.be.revertedWith("unsupported token");
    await escrow.connect(client).createJob(freelancer.address, await fee.getAddress(), "x", [item("a", U(100))], false);
    await expect(escrow.connect(client).fundMilestone(1, 0)).to.be.revertedWith("unsupported token");
  });
});
