const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const REVIEW = 3 * 24 * 3600;
const AMOUNT = 500n * 10n ** 6n; // 500 tokens with 6 decimals, like EURC and USDC

describe("FreelanceEscrow with ERC-20", () => {
  let escrow, token, client, freelancer, arbiter, other, deadline;

  beforeEach(async () => {
    [client, freelancer, arbiter, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("FreelanceEscrow", [arbiter.address, REVIEW]);
    token = await ethers.deployContract("MockERC20", ["Mock EURC", "EURC", 6]);
    await token.mint(client.address, 10_000n * 10n ** 6n);
    deadline = (await time.latest()) + 7 * 24 * 3600;
  });

  const fund = async () => {
    await token.connect(client).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(client).createTokenJob(freelancer.address, deadline, "ipfs://spec", await token.getAddress(), AMOUNT);
  };

  it("pulls the tokens into escrow and records the token", async () => {
    await fund();
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
    const job = await escrow.jobs(1);
    expect(job.token).to.equal(await token.getAddress());
    expect(job.amount).to.equal(AMOUNT);
    expect(job.status).to.equal(1n); // Funded
  });

  it("emits the token in JobCreated", async () => {
    await token.connect(client).approve(await escrow.getAddress(), AMOUNT);
    await expect(escrow.connect(client).createTokenJob(freelancer.address, deadline, "x", await token.getAddress(), AMOUNT))
      .to.emit(escrow, "JobCreated")
      .withArgs(1, client.address, freelancer.address, AMOUNT, deadline, await token.getAddress());
  });

  it("pays the freelancer in tokens on approval", async () => {
    await fund();
    await escrow.connect(freelancer).submitWork(1, "ipfs://work");
    await escrow.connect(client).approve(1);
    expect(await token.balanceOf(freelancer.address)).to.equal(AMOUNT);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
  });

  it("lets the freelancer claim in tokens after the review period", async () => {
    await fund();
    await escrow.connect(freelancer).submitWork(1, "x");
    await time.increase(REVIEW);
    await escrow.connect(freelancer).claimAfterTimeout(1);
    expect(await token.balanceOf(freelancer.address)).to.equal(AMOUNT);
  });

  it("refunds the client in tokens after an unmet deadline", async () => {
    await fund();
    const before = await token.balanceOf(client.address);
    await time.increaseTo(deadline + 1);
    await escrow.connect(client).refundExpired(1);
    expect(await token.balanceOf(client.address)).to.equal(before + AMOUNT);
  });

  it("lets the arbiter resolve a dispute in tokens either way", async () => {
    await fund();
    await escrow.connect(freelancer).submitWork(1, "x");
    await escrow.connect(client).dispute(1);
    const before = await token.balanceOf(client.address);
    await escrow.connect(arbiter).resolve(1, false);
    expect(await token.balanceOf(client.address)).to.equal(before + AMOUNT);
  });

  it("cannot be paid twice", async () => {
    await fund();
    await escrow.connect(freelancer).submitWork(1, "x");
    await escrow.connect(client).approve(1);
    await expect(escrow.connect(client).approve(1)).to.be.revertedWithCustomError(escrow, "WrongStatus");
    expect(await token.balanceOf(freelancer.address)).to.equal(AMOUNT);
  });

  it("reverts without an allowance and keeps no job", async () => {
    await expect(escrow.connect(client).createTokenJob(freelancer.address, deadline, "x", await token.getAddress(), AMOUNT)).to.be.revertedWithCustomError(
      escrow,
      "TransferFailed",
    );
    expect(await escrow.jobCount()).to.equal(0n);
  });

  it("rejects bad input", async () => {
    const t = await token.getAddress();
    await expect(escrow.connect(client).createTokenJob(freelancer.address, deadline, "x", t, 0)).to.be.revertedWith("no funds");
    await expect(escrow.connect(client).createTokenJob(freelancer.address, deadline, "x", ethers.ZeroAddress, AMOUNT)).to.be.revertedWith("bad token");
    await expect(escrow.connect(client).createTokenJob(freelancer.address, deadline, "x", other.address, AMOUNT)).to.be.revertedWith("bad token");
    await token.connect(client).approve(await escrow.getAddress(), AMOUNT);
    await expect(escrow.connect(client).createTokenJob(client.address, deadline, "x", t, AMOUNT)).to.be.revertedWith("bad freelancer");
  });

  it("rejects fee-on-transfer tokens", async () => {
    const fee = await ethers.deployContract("MockFeeToken");
    await fee.mint(client.address, AMOUNT);
    await fee.connect(client).approve(await escrow.getAddress(), AMOUNT);
    await expect(escrow.connect(client).createTokenJob(freelancer.address, deadline, "x", await fee.getAddress(), AMOUNT)).to.be.revertedWith("unsupported token");
  });

  it("ETH jobs still work and record no token", async () => {
    await escrow.connect(client).createJob(freelancer.address, deadline, "x", { value: 1000n });
    expect((await escrow.jobs(1)).token).to.equal(ethers.ZeroAddress);
    await escrow.connect(freelancer).submitWork(1, "x");
    await expect(escrow.connect(client).approve(1)).to.changeEtherBalance(freelancer, 1000n);
  });
});
