require("@nomicfoundation/hardhat-toolbox");
try {
  process.loadEnvFile();
} catch {}

const { DEPLOYER_PRIVATE_KEY } = process.env;

module.exports = {
  // The optimizer is needed to stay under the 24 KB contract size limit.
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    // The flow test runs its own chain on another port and points this at it.
    localhost: { url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545" },
    baseSepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
