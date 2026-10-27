const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const credAddr = "0x6Bb3A71C6408fCA66645278A1F1872B87f8EB54c";
  const didAddr  = "0x33C4D5Cb2048F8B3F0D6F1a64AdcAd458623635B";

  const PT = await (await ethers.getContractFactory("ProductTransfer")).deploy(credAddr, didAddr);
  await PT.waitForDeployment();
  const ptAddr = await PT.getAddress();
  console.log("✅ New ProductTransfer:", ptAddr);
  console.log("\nUpdate App.jsx ADDR.pt to:", `'${ptAddr}'`);
}
main().catch(err => { console.error(err); process.exit(1); });
