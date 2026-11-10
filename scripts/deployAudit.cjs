const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  const [deployer] = await ethers.getSigners();
  const TA = await (await ethers.getContractFactory("TraceabilityAudit")).deploy(
    '0x0Aa0F90f5fF643928fcf39EDC397d3484561a663',
    '0x79A69d11a648D765d96156a106985aA397ac1fB5',
    '0x5E8f94e5E18F159BF85ed97A47e822284eD454c7'
  );
  await TA.waitForDeployment();
  console.log("TraceabilityAudit:", await TA.getAddress());
}
main().catch(err => { console.error(err); process.exit(1); });
