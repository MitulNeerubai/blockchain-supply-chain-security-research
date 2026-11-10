import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import dotenv from "dotenv";
dotenv.config();

// Only the deployer key is required to deploy (it becomes rootGA).
// The other keys are optional and only used by scripts that act as each role.
const besuAccounts = [
  process.env.PRIVATE_KEY_ROOTGA,
  process.env.PRIVATE_KEY_LG,
  process.env.PRIVATE_KEY_MF,
  process.env.PRIVATE_KEY_DT,
  process.env.PRIVATE_KEY_RT,
].filter(k => /^(0x)?[0-9a-fA-F]{64}$/.test((k || "").trim())); // skips blanks + template placeholders

export default {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "london" },
  },
  networks: {
    hardhat: { chainId: 1337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 1337 },
    besu: {
      url: process.env.BESU_RPC || "https://eth.didlab.org",
      chainId: 252501,
      gas: 8000000,
      accounts: besuAccounts,
    },
  },
};
