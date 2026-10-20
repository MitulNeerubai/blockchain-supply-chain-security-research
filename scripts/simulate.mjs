// simulate.mjs — Full legitimate supply chain simulation
// Demonstrates: rootGA → LG → MF → DT → RT with real trust enforcement
// Usage: npx hardhat run scripts/simulate.mjs --network localhost

import hre from "hardhat";
const ethers = hre.ethers;

// ── PASTE ADDRESSES FROM deploy.mjs OUTPUT ─────────────────────────────────
// After running deploy.mjs, copy the addresses it prints and paste here:
const TRUST_REGISTRY   = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const AUDIT_LOG        = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const DID_REGISTRY     = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const CRED_REGISTRY    = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
const PRODUCT_TRANSFER = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const signers = await ethers.getSigners();
  const rootGA  = signers[0];  // deployer = Governance Authority
  const lg      = signers[1];  // Local Government
  const mf      = signers[2];  // Manufacturer
  const dt      = signers[3];  // Distributor
  const rt      = signers[4];  // Retailer

  console.log("\n=== SSI Supply Chain Simulation ===");
  console.log("rootGA :", rootGA.address);
  console.log("LG     :", lg.address);
  console.log("MF     :", mf.address);
  console.log("DT     :", dt.address);
  console.log("RT     :", rt.address);

  // Attach to deployed contracts (no signer arg — use .connect() per call)
  const trust = await ethers.getContractAt("TrustRegistry",      TRUST_REGISTRY);
  const audit = await ethers.getContractAt("AuditLog",           AUDIT_LOG);
  const did   = await ethers.getContractAt("DIDRegistry",        DID_REGISTRY);
  const cred  = await ethers.getContractAt("CredentialRegistry", CRED_REGISTRY);
  const pt    = await ethers.getContractAt("ProductTransfer",    PRODUCT_TRANSFER);

  // ── STEP 1: rootGA authorizes all actors ─────────────────────────────────
  console.log("\n── Step 1: rootGA authorizes issuers ──");
  await (await trust.connect(rootGA).authorizeIssuer(lg.address, "LocalGovt")).wait();
  await (await trust.connect(rootGA).authorizeIssuer(mf.address, "Manufacturer")).wait();
  await (await trust.connect(rootGA).authorizeIssuer(dt.address, "Distributor")).wait();
  await (await trust.connect(rootGA).authorizeIssuer(rt.address, "Retailer")).wait();
  console.log("  ✓ LG, MF, DT, RT authorized in TrustRegistry");

  // ── STEP 2: Each actor registers a DID ───────────────────────────────────
  console.log("\n── Step 2: Actors register DIDs ──");
  await (await did.connect(lg).registerDID("LocalGovt")).wait();
  await (await did.connect(mf).registerDID("Manufacturer")).wait();
  await (await did.connect(dt).registerDID("Distributor")).wait();
  await (await did.connect(rt).registerDID("Retailer")).wait();
  console.log("  ✓ DIDs registered for LG, MF, DT, RT");
  console.log("  LG DID:", await did.getDID(lg.address));
  console.log("  MF DID:", await did.getDID(mf.address));

  // ── STEP 3: LG issues GovtAuthority credential to MF ─────────────────────
  console.log("\n── Step 3: LG issues GovtAuthority credential to MF ──");
  const lgToMfTx = await cred.connect(lg).issueCredential(
    mf.address,
    "GovtAuthority",
    365   // valid for 365 days
  );
  const lgToMfReceipt = await lgToMfTx.wait();
  const govtCredId = lgToMfReceipt.logs
    .map(l => { try { return cred.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "CredentialIssued")
    .args.credentialId;
  console.log("  ✓ GovtAuthority credential issued");
  console.log("  Credential ID:", govtCredId);

  // ── STEP 4: LG issues ManufacturingLicense to MF ─────────────────────────
  console.log("\n── Step 4: LG issues ManufacturingLicense to MF ──");
  const mfLicTx = await cred.connect(lg).issueCredential(
    mf.address,
    "ManufacturingLicense",
    365
  );
  const mfLicReceipt = await mfLicTx.wait();
  const mfLicCredId = mfLicReceipt.logs
    .map(l => { try { return cred.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "CredentialIssued")
    .args.credentialId;
  console.log("  ✓ ManufacturingLicense issued to MF");

  // ── STEP 5: MF issues TradeLicense to DT ─────────────────────────────────
  console.log("\n── Step 5: MF issues TradeLicense to DT ──");
  const dtLicTx = await cred.connect(mf).issueCredential(
    dt.address,
    "TradeLicense",
    180
  );
  const dtLicReceipt = await dtLicTx.wait();
  const dtLicCredId = dtLicReceipt.logs
    .map(l => { try { return cred.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "CredentialIssued")
    .args.credentialId;
  console.log("  ✓ TradeLicense issued to DT");

  // ── STEP 6: DT issues TradeLicense to RT ─────────────────────────────────
  console.log("\n── Step 6: DT issues TradeLicense to RT ──");
  const rtLicTx = await cred.connect(dt).issueCredential(
    rt.address,
    "TradeLicense",
    180
  );
  const rtLicReceipt = await rtLicTx.wait();
  const rtLicCredId = rtLicReceipt.logs
    .map(l => { try { return cred.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "CredentialIssued")
    .args.credentialId;
  console.log("  ✓ TradeLicense issued to RT");

  // ── STEP 7: MF creates a product (requires ManufacturingLicense) ──────────
  console.log("\n── Step 7: MF creates product ──");
  const createTx = await pt.connect(mf).createProduct("Widget-Alpha-001", mfLicCredId);
  const createReceipt = await createTx.wait();
  const productId = createReceipt.logs
    .map(l => { try { return pt.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "ProductCreated")
    .args.productId;
  console.log("  ✓ Product created, ID:", productId.toString());
  console.log("  Manufacturing credential now linked to product");

  // ── STEP 8: MF commits transfer to DT with a secret ──────────────────────
  console.log("\n── Step 8: MF commits transfer to DT ──");
  const secret = "HANDSHAKE_MF_TO_DT_42";
  const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
  console.log("  Secret (shared off-chain with DT):", secret);
  console.log("  SecretHash stored on-chain:", secretHash);

  await (await pt.connect(mf).commitTransfer(
    productId,
    secretHash,
    dt.address,
    dtLicCredId   // DT must hold this credential to claim
  )).wait();
  console.log("  ✓ Transfer committed — product locked");

  // ── STEP 9: DT claims the product with the secret ────────────────────────
  console.log("\n── Step 9: DT claims product with secret ──");
  await (await pt.connect(dt).claimTransfer(productId, secret)).wait();
  console.log("  ✓ Transfer claimed — DT is now the holder");

  // ── STEP 10: DT → RT (same pattern) ──────────────────────────────────────
  console.log("\n── Step 10: DT commits transfer to RT ──");
  const secret2 = "HANDSHAKE_DT_TO_RT_99";
  const secretHash2 = ethers.keccak256(ethers.toUtf8Bytes(secret2));
  await (await pt.connect(dt).commitTransfer(
    productId, secretHash2, rt.address, rtLicCredId
  )).wait();
  console.log("  ✓ Transfer committed to RT");

  console.log("\n── Step 11: RT claims product ──");
  await (await pt.connect(rt).claimTransfer(productId, secret2)).wait();
  console.log("  ✓ RT is now final holder — product DELIVERED");

  // ── VERIFY FINAL STATE ────────────────────────────────────────────────────
  console.log("\n── Step 12: 8-point credential verification on final state ──");
  const [valid, reason] = await cred.verifyCredential(
    mfLicCredId,
    mf.address,
    "ManufacturingLicense",
    productId
  );
  console.log("  Manufacturing credential valid:", valid);
  if (!valid) console.log("  Reason:", reason);

  const finalProduct = await pt.getProduct(productId);
  const statusNames = ["Created", "InTransit", "Delivered", "Revoked"];
  console.log("  Final product holder:", finalProduct.currentHolder);
  console.log("  RT address:          ", rt.address);
  console.log("  Status:", statusNames[Number(finalProduct.status)]);
  console.log("  Holder matches RT:", finalProduct.currentHolder === rt.address);

  // ── AUDIT LOG ─────────────────────────────────────────────────────────────
  console.log("\n── Audit Log (all entries) ──");
  const totalEntries = await audit.totalEntries();
  console.log("  Total entries:", totalEntries.toString());
  for (let i = 0n; i < totalEntries; i++) {
    const entry = await audit.getEntry(i);
    const ts = new Date(Number(entry.timestamp) * 1000).toISOString();
    console.log(`  [${i}] ${ts} | ${entry.action} | actor: ${entry.actor.slice(0,10)}...`);
  }

  // ── TEST BLOCKED TRANSACTION ──────────────────────────────────────────────
  console.log("\n── Blocked Transaction Test ──");
  const attacker = signers[5];
  console.log("  Attacker address:", attacker.address, "(not authorized)");
  try {
    await (await trust.connect(attacker).authorizeIssuer(attacker.address, "Hacker")).wait();
    console.log("  ✗ ERROR: attacker was able to authorize themselves!");
  } catch (e) {
    console.log("  ✓ BLOCKED: attacker cannot call authorizeIssuer (not rootGA)");
    console.log("    Revert reason:", e.message.includes("rootGA") ? "Only rootGA can call this" : e.message.split("\n")[0]);
  }

  console.log("\n=== SIMULATION COMPLETE ===\n");
}

main().catch(err => { console.error(err); process.exit(1); });
