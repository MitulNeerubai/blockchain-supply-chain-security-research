import hardhat from "hardhat";
const { ethers } = hardhat;

async function main() {
  const wallets = await ethers.getSigners();
  const rootGA = wallets[0];
  const lg = wallets[1];
  const mf = wallets[2];

  console.log("Deploying contracts...");
  console.log("rootGA:", rootGA.address);
  console.log("LG:", lg.address);
  console.log("MF:", mf.address);

  const DIDRegistry = await ethers.getContractFactory("DIDRegistry");
  const didRegistry = await DIDRegistry.deploy();
  await didRegistry.waitForDeployment();
  console.log("DIDRegistry deployed to:", await didRegistry.getAddress());

  const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
  const credentialRegistry = await CredentialRegistry.deploy();
  await credentialRegistry.waitForDeployment();
  console.log("CredentialRegistry deployed to:", await credentialRegistry.getAddress());

  const ProductTransfer = await ethers.getContractFactory("ProductTransfer");
  const productTransfer = await ProductTransfer.deploy();
  await productTransfer.waitForDeployment();
  console.log("ProductTransfer deployed to:", await productTransfer.getAddress());

  console.log("\nAll contracts deployed successfully!");

  return {
    didRegistry: await didRegistry.getAddress(),
    credentialRegistry: await credentialRegistry.getAddress(),
    productTransfer: await productTransfer.getAddress()
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
