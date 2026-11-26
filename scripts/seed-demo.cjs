// scripts/seed-demo.cjs - populate the chain with realistic demo data.
//
// Creates a realistic cattle/meat supply chain with companies at proper
// licence tiers and products at DIFFERENT stages (not all delivered).
//
// Run AFTER a fresh deploy:
//   npm run deploy:besu
//   ALLOW_BESU=1 npx hardhat run scripts/seed-demo.cjs --network besu
//
// Or on localhost:
//   npx hardhat run scripts/seed-demo.cjs --network localhost

const hre = require("hardhat");
const { ethers } = hre;
const dep = require("../src/deployment.json");

async function main() {
  const NET = hre.network.name;
  const isBesu = NET === "besu";
  if (isBesu && process.env.ALLOW_BESU !== "1") {
    console.error("Pass ALLOW_BESU=1 to write to the live Besu chain.");
    process.exit(1);
  }

  const provider = ethers.provider;
  const [root] = await ethers.getSigners();
  if (!root) throw new Error("No deployer account. Set PRIVATE_KEY_ROOTGA in .env for Besu.");
  const C = (k, s) => new ethers.Contract(dep.contracts[k].address, dep.contracts[k].abi, s);
  const { chainId } = await provider.getNetwork();
  const expiresAt = (await provider.getBlock("latest")).timestamp + 365 * 86400;

  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
  const needFund = gasPrice > 0n;
  const FUND = process.env.FUND_ETH || "0.03";

  console.log(`Network: ${NET} (chainId ${chainId})  gasPrice=${gasPrice}`);

  // ── Company definitions ─────────────────────────────────────────────────
  const COMPANIES = {
    lg:  [{ role: "LocalGovt",    name: "Kansas Dept of Agriculture",  region: "Kansas, USA" }],
    mf:  [
      { role: "Manufacturer", name: "Prairie Creek Cattle Ranch" },
      { role: "Manufacturer", name: "Heartland Beef Co." },
    ],
    dt:  [
      { role: "Distributor", name: "Midwest Meat Distributors" },
      { role: "Distributor", name: "Central Plains Cold Storage" },
    ],
    rt:  [
      { role: "Retailer", name: "FreshMart Grocery" },
      { role: "Retailer", name: "Corner Butcher Shop" },
      { role: "Retailer", name: "Valley Foods Market" },
    ],
  };

  // ── Product definitions (each has a target stage) ───────────────────────
  // stage: "mf" = at manufacturer, "transit_dt" = shipped to DT,
  //        "dt" = at distributor, "transit_rt" = shipped to RT, "rt" = delivered
  const PRODUCTS = [
    { name: "Angus Beef Ribeye - 12oz",        qty: 500,  batch: "PCR-2026-001", desc: "USDA Choice grade, dry-aged 21 days",        mf: 0, dt: 0, rt: 0, stage: "rt" },
    { name: "Ground Beef 80/20 - 1lb",         qty: 1200, batch: "PCR-2026-002", desc: "Fresh ground, family pack",                  mf: 0, dt: 0, rt: 1, stage: "rt" },
    { name: "Prime Sirloin Steak - 16oz",      qty: 300,  batch: "PCR-2026-003", desc: "USDA Prime, hand-trimmed",                   mf: 0, dt: 0, rt: 2, stage: "rt" },
    { name: "Beef Chuck Roast - 3lb",          qty: 400,  batch: "PCR-2026-004", desc: "Bone-in, slow cooker ready",                 mf: 0, dt: 0, rt: 0, stage: "transit_rt" },
    { name: "Wagyu Burger Patties - 4pk",      qty: 200,  batch: "PCR-2026-005", desc: "American Wagyu blend, 6oz each",             mf: 0, dt: 0, rt: 1, stage: "transit_rt" },
    { name: "T-Bone Steak - 20oz",             qty: 250,  batch: "HBC-2026-001", desc: "Center cut, premium grade",                  mf: 1, dt: 1, rt: 1, stage: "dt" },
    { name: "Beef Tenderloin - 2lb",           qty: 150,  batch: "HBC-2026-002", desc: "Whole tenderloin, trimmed",                  mf: 1, dt: 1, rt: 2, stage: "dt" },
    { name: "Flank Steak - 1.5lb",            qty: 600,  batch: "HBC-2026-003", desc: "Grass-fed, marinating cut",                  mf: 1, dt: 1, rt: 0, stage: "transit_dt" },
    { name: "Short Ribs - 2lb",               qty: 350,  batch: "HBC-2026-004", desc: "English cut, braising quality",              mf: 1, dt: 1, rt: 0, stage: "transit_dt" },
    { name: "Beef Brisket - 5lb",             qty: 180,  batch: "PCR-2026-006", desc: "Whole packer, competition grade",            mf: 0, dt: 0, rt: 0, stage: "mf" },
    { name: "New York Strip - 14oz",          qty: 400,  batch: "PCR-2026-007", desc: "USDA Choice, center cut",                    mf: 0, dt: 0, rt: 0, stage: "mf" },
    { name: "Beef Jerky Strips - 8oz",        qty: 800,  batch: "HBC-2026-005", desc: "Hickory smoked, ready to package",           mf: 1, dt: 1, rt: 0, stage: "mf" },
  ];

  // ── Generate wallets ────────────────────────────────────────────────────
  const total = COMPANIES.lg.length + COMPANIES.mf.length + COMPANIES.dt.length + COMPANIES.rt.length;
  process.stdout.write(`Generating ${total} wallets... `);
  const wallets = Array.from({ length: total }, () => ethers.Wallet.createRandom().connect(provider));
  console.log("done.");

  if (needFund) {
    const per = ethers.parseEther(FUND);
    process.stdout.write(`Funding ${total} wallets with ${FUND} TRUST each... `);
    let nonce = await provider.getTransactionCount(root.address);
    const txs = [];
    for (const w of wallets) txs.push(await root.sendTransaction({ to: w.address, value: per, nonce: nonce++ }));
    await Promise.all(txs.map(t => t.wait()));
    console.log("done.");
  }

  let idx = 0;
  const lgWallets = COMPANIES.lg.map(() => wallets[idx++]);
  const mfWallets = COMPANIES.mf.map(() => wallets[idx++]);
  const dtWallets = COMPANIES.dt.map(() => wallets[idx++]);
  const rtWallets = COMPANIES.rt.map(() => wallets[idx++]);

  // ── 1. Register companies ──────────────────────────────────────────────
  console.log("\n1. Registering companies...");
  const lg = lgWallets[0];
  const lgInfo = COMPANIES.lg[0];
  const tx1 = await (await C("did", root).registerLocalGovt(lg.address, lgInfo.name, lgInfo.region)).wait();
  console.log(`   LG: ${lgInfo.name} (${lg.address.slice(0, 10)}...)`);

  const tx2 = await (await C("trust", root).authorizeIssuer(lg.address, "LocalGovt")).wait();
  console.log(`   LG authorized by Root`);

  for (let i = 0; i < mfWallets.length; i++) {
    await (await C("did", mfWallets[i]).registerDID("Manufacturer", COMPANIES.mf[i].name)).wait();
    console.log(`   MF: ${COMPANIES.mf[i].name}`);
  }
  for (let i = 0; i < dtWallets.length; i++) {
    await (await C("did", dtWallets[i]).registerDID("Distributor", COMPANIES.dt[i].name)).wait();
    console.log(`   DT: ${COMPANIES.dt[i].name}`);
  }
  for (let i = 0; i < rtWallets.length; i++) {
    await (await C("did", rtWallets[i]).registerDID("Retailer", COMPANIES.rt[i].name)).wait();
    console.log(`   RT: ${COMPANIES.rt[i].name}`);
  }

  // ── 2. Issue licences (LG->MF, MF->DT, DT->RT) ───────────────────────
  console.log("\n2. Issuing licences...");
  for (const mf of mfWallets) {
    await (await C("cred", lg).issueCredential(mf.address, expiresAt)).wait();
    console.log(`   LG -> MF (${mf.address.slice(0, 10)}...)`);
  }
  // MF0 licenses DT0, MF1 licenses DT1
  for (let i = 0; i < dtWallets.length; i++) {
    await (await C("cred", mfWallets[i]).issueCredential(dtWallets[i].address, expiresAt)).wait();
    console.log(`   MF${i} -> DT${i}`);
  }
  // DT0 licenses RT0,RT1 ; DT1 licenses RT2
  await (await C("cred", dtWallets[0]).issueCredential(rtWallets[0].address, expiresAt)).wait();
  console.log("   DT0 -> RT0");
  await (await C("cred", dtWallets[0]).issueCredential(rtWallets[1].address, expiresAt)).wait();
  console.log("   DT0 -> RT1");
  await (await C("cred", dtWallets[1]).issueCredential(rtWallets[2].address, expiresAt)).wait();
  console.log("   DT1 -> RT2");

  // ── 3. Create products and move them to their target stages ────────────
  console.log("\n3. Creating products and moving through supply chain...");
  const createdTopic = C("pt", root).interface.getEvent("ProductCreated").topicHash;

  for (const prod of PRODUCTS) {
    const mf = mfWallets[prod.mf];
    const dt = dtWallets[prod.dt];
    const rt = rtWallets[prod.rt];

    // Create
    const rc = await (await C("pt", mf).createProduct(prod.name, "", prod.qty, prod.desc, prod.batch, 15)).wait();
    const id = C("pt", mf).interface.parseLog(rc.logs.find(l => l.topics[0] === createdTopic)).args.id;
    let status = "At manufacturer";

    if (prod.stage === "mf") {
      console.log(`   #${id} ${prod.name} -> ${status}`);
      continue;
    }

    // Ship MF -> DT
    await (await C("pt", mf).shipTo(id, dt.address)).wait();
    status = "In transit to distributor";

    if (prod.stage === "transit_dt") {
      console.log(`   #${id} ${prod.name} -> ${status}`);
      continue;
    }

    // Confirm at DT
    await (await C("pt", dt).confirmReceipt(id)).wait();
    status = "At distributor";

    if (prod.stage === "dt") {
      console.log(`   #${id} ${prod.name} -> ${status}`);
      continue;
    }

    // Ship DT -> RT
    await (await C("pt", dt).shipTo(id, rt.address)).wait();
    status = "In transit to retailer";

    if (prod.stage === "transit_rt") {
      console.log(`   #${id} ${prod.name} -> ${status}`);
      continue;
    }

    // Confirm at RT (delivered)
    await (await C("pt", rt).confirmReceipt(id)).wait();
    status = "Delivered to store";

    console.log(`   #${id} ${prod.name} -> ${status}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const totalProducts = Number(await C("pt", root).totalProducts());
  const totalCompanies = Number(await C("did", root).totalDIDs());
  const totalCreds = Number(await C("cred", root).totalCredentials());

  console.log("\n" + "=".repeat(50));
  console.log("DEMO DATA SEEDED");
  console.log("=".repeat(50));
  console.log(`Companies: ${totalCompanies} (1 LG + ${mfWallets.length} MF + ${dtWallets.length} DT + ${rtWallets.length} RT)`);
  console.log(`Licences:  ${totalCreds}`);
  console.log(`Products:  ${totalProducts}`);
  console.log("");
  console.log("Product stages:");
  console.log(`  At manufacturer:          ${PRODUCTS.filter(p => p.stage === "mf").length}`);
  console.log(`  In transit to distributor: ${PRODUCTS.filter(p => p.stage === "transit_dt").length}`);
  console.log(`  At distributor:            ${PRODUCTS.filter(p => p.stage === "dt").length}`);
  console.log(`  In transit to retailer:    ${PRODUCTS.filter(p => p.stage === "transit_rt").length}`);
  console.log(`  Delivered to store:        ${PRODUCTS.filter(p => p.stage === "rt").length}`);
  console.log("=".repeat(50));
}

main().catch(e => { console.error(e); process.exit(1); });
