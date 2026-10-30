require("@nomicfoundation/hardhat-toolbox");
// ENV_FILE picks the settings file. For real money use its own (ENV_FILE=.env.mainnet): then nothing from the test
// network's .env, such as its keys and mock token addresses, is in the room.
try {
  process.loadEnvFile(process.env.ENV_FILE || ".env");
} catch {}

const { DEPLOYER_PRIVATE_KEY, MAINNET_DEPLOYER_PRIVATE_KEY, BASE_RPC_URL, ETHERSCAN_API_KEY } = process.env;

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
    // Real money. Its own key and its own RPC, named on purpose: the test network's key and a public RPC can't end up
    // here by accident. Deploy with scripts/deploy-mainnet.cjs (npm run deploy:mainnet), never with scripts/deploy.cjs.
    base: {
      url: BASE_RPC_URL || "https://base-rpc-not-set.invalid",
      chainId: 8453,
      accounts: MAINNET_DEPLOYER_PRIVATE_KEY ? [MAINNET_DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  // To publish the source on Basescan (hardhat verify). One Etherscan key works for Base too.
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
};
