// deploy_all.cjs — deploys all 6 contracts and writes src/deployment.json
//
//   npm run deploy:besu     (DIDLab Besu, uses PRIVATE_KEY_ROOTGA from .env)
//   npm run deploy:local    (against `npx hardhat node`)
//
// The deployer wallet becomes rootGA. The frontend reads addresses + ABIs from
// src/deployment.json, so there is nothing to paste into App.jsx any more.
// Rebuild the UI afterwards: npm run build

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

const RPC_FOR = { besu: "https://eth.didlab.org", localhost: "http://127.0.0.1:8545", hardhat: "http://127.0.0.1:8545" };

async function main() {
  if (hre.network.name === "hardhat") {
    console.warn("⚠️  Deploying to the throw-away in-process 'hardhat' network.");
    console.warn("    Use `npm run deploy:besu` (or --network besu) for the real chain.\n");
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. Set PRIVATE_KEY_ROOTGA in .env");
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Network: ${hre.network.name} (chainId ${chainId})`);
  console.log(`Deployer / rootGA: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer))}\n`);

  const deploy = async (name, ...args) => {
    const opts = name === "ProductTransfer" ? { libraries: { Custody: custodyAddr } } : {};
    const c = await (await ethers.getContractFactory(name, opts)).deploy(...args);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    console.log(`✅ ${name.padEnd(19)} ${addr}`);
    return { c, addr };
  };

  let custodyAddr;
  const custody = await deploy("Custody");           // linked library used by ProductTransfer
  custodyAddr = custody.addr;
  const audit = await deploy("AuditLog");
  const trust = await deploy("TrustRegistry");
  const did   = await deploy("DIDRegistry", trust.addr, audit.addr);
  const cred  = await deploy("CredentialRegistry", trust.addr, did.addr, audit.addr);
  const pt    = await deploy("ProductTransfer", cred.addr, did.addr, audit.addr);
  const ta    = await deploy("TraceabilityAudit", pt.addr, cred.addr, did.addr);

  console.log("\nRegistering contracts in AuditLog…");
  for (const [x, label] of [[did, "DIDRegistry"], [cred, "CredentialRegistry"], [pt, "ProductTransfer"]]) {
    await (await audit.c.registerContract(x.addr, label)).wait();
  }

  const block = await ethers.provider.getBlockNumber();
  const abi = name => hre.artifacts.readArtifactSync(name).abi;
  const deployment = {
    network: hre.network.name,
    chainId: Number(chainId),
    rpcUrl: process.env.PUBLIC_RPC || RPC_FOR[hre.network.name] || hre.network.config.url,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    deployBlock: block,
    contracts: {
      custody: { name: "Custody",           address: custody.addr, abi: [] },
      audit:  { name: "AuditLog",           address: audit.addr, abi: abi("AuditLog") },
      trust:  { name: "TrustRegistry",      address: trust.addr, abi: abi("TrustRegistry") },
      did:    { name: "DIDRegistry",        address: did.addr,   abi: abi("DIDRegistry") },
      cred:   { name: "CredentialRegistry", address: cred.addr,  abi: abi("CredentialRegistry") },
      pt:     { name: "ProductTransfer",    address: pt.addr,    abi: abi("ProductTransfer") },
      ta:     { name: "TraceabilityAudit",  address: ta.addr,    abi: abi("TraceabilityAudit") },
    },
  };

  // Write next to the UI source (root src/ locally, supply-chain-ui/src/ on the server)
  const targets = ["src", "supply-chain-ui/src"].map(d => path.join(__dirname, d)).filter(d => fs.existsSync(d));
  fs.mkdirSync(path.join(__dirname, "deployments"), { recursive: true });
  const json = JSON.stringify(deployment, null, 2);
  for (const d of targets) fs.writeFileSync(path.join(d, "deployment.json"), json);
  fs.writeFileSync(path.join(__dirname, "deployments", `${hre.network.name}.json`), json);

  console.log("\nWrote deployment.json to:", [...targets, "deployments/"].map(p => path.relative(__dirname, p) || ".").join(", "));
  console.log("Next: npm run build   (then copy dist/ to the web root)");
}

main().catch(err => { console.error(err); process.exit(1); });
