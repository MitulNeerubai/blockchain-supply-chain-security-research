// simulate.mjs — Full legitimate supply chain simulation
// Demonstrates: rootGA → LG → MF → DT → RT with real trust enforcement
// Usage: npx hardhat run scripts/simulate.mjs --network localhost

import hre from "hardhat";
const ethers = hre.ethers;

// ── PASTE ADDRESSES FROM deploy.mjs OUTPUT ─────────────────────────────────
// After running deploy.mjs, copy the addresses it prints and paste here:
const TRUST_REGISTRY   = "0x0A4502802C243e7C6f464BFDf1D967ec5Ad042d2";
const AUDIT_LOG        = "0x6784193B5FF7C8f2733Ee80C4c1bE22B4bF49B85";
const DID_REGISTRY     = "0x3559e6f0D6721eA20De0cD5B9cbA7929838aAe24";
const CRED_REGISTRY    = "0x635d0cA791d1BEA4471FDd10F276693fC1c8EF6f";
const PRODUCT_TRANSFER = "0x6d1b146f301bc83E1362d29797b8b1c396132Ca1";
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
  for (const [addr, name] of [[lg.address,"LocalGovt"],[mf.address,"Manufacturer"],[dt.address,"Distributor"],[rt.address,"Retailer"]]) {
    try { await (await trust.connect(rootGA).authorizeIssuer(addr, name)).wait(); }
    catch (e) { console.log(`  ℹ ${name} already authorized — skipping`); }
  }
  console.log("  ✓ LG, MF, DT, RT authorized in TrustRegistry");

  // ── STEP 2: Each actor registers a DID ───────────────────────────────────
  console.log("\n── Step 2: Actors register DIDs ──");
  for (const [signer, name] of [[lg,"LocalGovt"],[mf,"Manufacturer"],[dt,"Distributor"],[rt,"Retailer"]]) {
    try { await (await did.connect(signer).registerDID(name)).wait(); }
    catch (e) { console.log(`  ℹ ${name} DID already registered — skipping`); }
  }
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

  // ── TAMPER TEST: Wrong Secret Attack ─────────────────────────────────────
  console.log("\n── Tamper Test: Wrong Secret Attack ──");
  console.log("  Creating a separate product for the tamper test...");

  // Issue a FRESH credential specifically for this test product
  const tamperCredTx = await cred.connect(lg).issueCredential(mf.address, "ManufacturingLicense", 365);
  const tamperCredReceipt = await tamperCredTx.wait();
  const tamperCredId = tamperCredReceipt.logs
    .map(l => { try { return cred.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "CredentialIssued")
    .args.credentialId;
  console.log("  ✓ Fresh ManufacturingLicense issued for tamper test");

  const createTx2 = await pt.connect(mf).createProduct("Widget-TAMPER-TEST", tamperCredId);
  const createReceipt2 = await createTx2.wait();
  const productId2 = createReceipt2.logs
    .map(l => { try { return pt.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "ProductCreated")
    .args.productId;

  const secret3 = "HANDSHAKE_MF_TO_DT_NEW";
  const secretHash3 = ethers.keccak256(ethers.toUtf8Bytes(secret3));
  await (await pt.connect(mf).commitTransfer(productId2, secretHash3, dt.address, dtLicCredId)).wait();
  console.log("  Product created and transfer committed to DT");
  console.log("  Real secret:", secret3);

  // Attacker tries the wrong secret
  try {
    await (await pt.connect(dt).claimTransfer(productId2, "WRONG_SECRET_HAHA")).wait();
    console.log("  ✗ ERROR: Wrong secret was accepted!");
  } catch (e) {
    console.log("  ✓ BLOCKED: Wrong secret rejected — transfer denied");
  }

  // Now use the correct secret — should work
  await (await pt.connect(dt).claimTransfer(productId2, secret3)).wait();
  console.log("  ✓ CONFIRMED: Correct secret accepted — DT is now holder");

  console.log("\n=== SIMULATION COMPLETE ===\n");
}

main().catch(err => { console.error(err); process.exit(1); });
