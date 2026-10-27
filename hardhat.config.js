import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
dotenv.config();

export default {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      chainId: 1337
    },
    besu: {
      url: "https://eth.didlab.org",
      chainId: 252501,
      accounts: [
        process.env.PRIVATE_KEY_ROOTGA,
        process.env.PRIVATE_KEY_LG,
        process.env.PRIVATE_KEY_MF,
        process.env.PRIVATE_KEY_DT,
        process.env.PRIVATE_KEY_RT
      ]
    }
  }
};
