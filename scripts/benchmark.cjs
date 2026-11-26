// scripts/benchmark.cjs - synthetic-data load test (local OR Besu).
//
// Builds a synthetic supply chain (many MF / DT / RT), runs the full product
// lifecycle as real transactions, and measures how much load the chain holds:
//   - gas used per operation type
//   - execution time + throughput (transactions per second) as load grows
//   - read-back check that the whole dataset is still retrievable
// Writes results to benchmark-results/*.csv for the paper.
//
// LOCAL (safe, throwaway - nothing survives stopping the node):
//   npx hardhat node                                  (terminal 1)
//   npm run deploy:local                              (terminal 2)
//   npm run benchmark:local
//
// BESU (REAL chain - synthetic data stays on it until the next redeploy):
//   needs PRIVATE_KEY_ROOTGA in .env with enough TRUST for gas.
//   ALLOW_BESU=1 npm run benchmark:besu
//
// Tune scale with env vars (defaults in parens). Start SMALL on Besu:
//   NUM_MF(10) DT_PER_MF(1) RT_PER_DT(5) NUM_PRODUCTS(180) FUND_ETH(10)
//   e.g.  ALLOW_BESU=1 NUM_PRODUCTS=40 npm run benchmark:besu

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const dep = require("../src/deployment.json");

const num = (k, d) => Number(process.env[k] || d);
const NUM_MF       = num("NUM_MF", 10);
const DT_PER_MF    = num("DT_PER_MF", 1);
const RT_PER_DT    = num("RT_PER_DT", 5);
const NUM_PRODUCTS = num("NUM_PRODUCTS", 180);
const FUND_ETH     = process.env.FUND_ETH || "10";
const STEP         = 100;   // report a throughput snapshot every STEP transactions

async function main() {
  const NET = hre.network.name;
  const isBesu = NET === "besu";
  if (isBesu && process.env.ALLOW_BESU !== "1") {
    console.error([
      "Refusing to run against Besu without confirmation.",
      "This writes synthetic data to the LIVE chain permanently (until the next redeploy).",
      "Start SMALL, e.g.:   ALLOW_BESU=1 NUM_PRODUCTS=40 npm run benchmark:besu",
    ].join("\n"));
    process.exit(1);
  }

  const provider = ethers.provider;
  const [root] = await ethers.getSigners();          // deployer == rootGA
  if (!root) throw new Error("No deployer account. Set PRIVATE_KEY_ROOTGA in .env for Besu.");
  const C = (k, s) => new ethers.Contract(dep.contracts[k].address, dep.contracts[k].abi, s);
  const { chainId } = await provider.getNetwork();
  const expiresAt = (await provider.getBlock("latest")).timestamp + 365 * 86400;

  // ── Metrics ─────────────────────────────────────────────────────────────────
  const perOp = {};            // label -> { count, gas: bigint, ms }
  const blocks = new Set();
  const timeline = [];
  let txCount = 0, startTime = 0;
  function record(label, gasUsed, ms, blockNumber) {
    txCount++;
    const o = perOp[label] || (perOp[label] = { count: 0, gas: 0n, ms: 0 });
    o.count++; o.gas += BigInt(gasUsed); o.ms += ms;
    if (blockNumber != null) blocks.add(Number(blockNumber));
    if (txCount % STEP === 0) timeline.push({ tx: txCount, elapsedMs: Date.now() - startTime });
  }
  async function send(label, call) {
    const t0 = Date.now();
    const rc = await (await call).wait();
    record(label, rc.gasUsed, Date.now() - t0, rc.blockNumber);
    return rc;
  }

  // ── Generate wallets; fund them only if gas actually costs something ─────────
  const totalWallets = 1 + NUM_MF + NUM_MF * DT_PER_MF + NUM_MF * DT_PER_MF * RT_PER_DT;
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
  const needFund = gasPrice > 0n;

  console.log(`Network: ${NET} (chainId ${chainId})  gasPrice=${gasPrice}  funding=${needFund ? "yes" : "no (free gas)"}`);
  if (isBesu) console.log("!! Writing synthetic data to the LIVE Besu chain. Redeploy afterward for a clean demo. !!");

  process.stdout.write(`Generating ${totalWallets} wallets… `);
  const wallets = Array.from({ length: totalWallets }, () => ethers.Wallet.createRandom().connect(provider));
  console.log("done.");

  if (needFund) {
    const per = ethers.parseEther(FUND_ETH);
    const bal = await provider.getBalance(root.address);
    if (bal < per * BigInt(totalWallets))
      throw new Error(`rootGA balance ${ethers.formatEther(bal)} < needed ${ethers.formatEther(per * BigInt(totalWallets))} (${FUND_ETH} x ${totalWallets}). Lower FUND_ETH or top up.`);
    process.stdout.write(`Funding ${totalWallets} wallets with ${FUND_ETH} each… `);
    let nonce = await provider.getTransactionCount(root.address);
    const txs = [];
    for (const w of wallets) txs.push(await root.sendTransaction({ to: w.address, value: per, nonce: nonce++ }));
    await Promise.all(txs.map(t => t.wait()));
    console.log("done.");
  }

  let k = 0; const nextW = () => wallets[k++];
  const lg = nextW();
  const mfs = Array.from({ length: NUM_MF }, nextW);
  const dts = Array.from({ length: NUM_MF * DT_PER_MF }, nextW);
  const rts = Array.from({ length: NUM_MF * DT_PER_MF * RT_PER_DT }, nextW);
  const dtOf = i => dts[i * DT_PER_MF];                                    // this MF's distributor
  const rtOf = (i, p) => rts[(i * DT_PER_MF) * RT_PER_DT + (p % RT_PER_DT)]; // one of that DT's retailers

  console.log(`Synthetic chain: 1 LG, ${mfs.length} MF, ${dts.length} DT, ${rts.length} RT; ${NUM_PRODUCTS} products.`);
  console.log("Running…\n");
  startTime = Date.now();

  // ── 1. Register + license everyone (licences cascade LG->MF->DT->RT) ─────────
  await send("registerLocalGovt", C("did", root).registerLocalGovt(lg.address, "Benchmark LG", "Benchmark Region " + Date.now()));
  await send("authorizeIssuer",   C("trust", root).authorizeIssuer(lg.address, "LocalGovt"));
  for (let i = 0; i < mfs.length; i++) await send("registerDID(MF)", C("did", mfs[i]).registerDID("Manufacturer", `MF ${i} ${chainId}-${startTime}`));
  for (let i = 0; i < dts.length; i++) await send("registerDID(DT)", C("did", dts[i]).registerDID("Distributor", `DT ${i} ${chainId}-${startTime}`));
  for (let i = 0; i < rts.length; i++) await send("registerDID(RT)", C("did", rts[i]).registerDID("Retailer", `RT ${i} ${chainId}-${startTime}`));
  for (const mf of mfs) await send("issueCredential(LG->MF)", C("cred", lg).issueCredential(mf.address, expiresAt));
  for (let i = 0; i < mfs.length; i++)
    for (let d = 0; d < DT_PER_MF; d++)
      await send("issueCredential(MF->DT)", C("cred", mfs[i]).issueCredential(dts[i * DT_PER_MF + d].address, expiresAt));
  for (let i = 0; i < dts.length; i++)
    for (let r = 0; r < RT_PER_DT; r++)
      await send("issueCredential(DT->RT)", C("cred", dts[i]).issueCredential(rts[i * RT_PER_DT + r].address, expiresAt));

  // ── 2. Product lifecycle: create -> ship -> confirm -> ship -> confirm ───────
  const createdTopic = C("pt", root).interface.getEvent("ProductCreated").topicHash;
  for (let p = 0; p < NUM_PRODUCTS; p++) {
    const mfIdx = p % NUM_MF, mf = mfs[mfIdx], dt = dtOf(mfIdx), rt = rtOf(mfIdx, p);
    const rc = await send("createProduct", C("pt", mf).createProduct(`Product ${p}`, "", 100, `Synthetic ${p}`, `B-${mfIdx}-${p}-${startTime}`, 15));
    const id = C("pt", mf).interface.parseLog(rc.logs.find(l => l.topics[0] === createdTopic)).args.id;
    await send("shipTo(MF->DT)",     C("pt", mf).shipTo(id, dt.address));
    await send("confirmReceipt(DT)", C("pt", dt).confirmReceipt(id));
    await send("shipTo(DT->RT)",     C("pt", dt).shipTo(id, rt.address));
    await send("confirmReceipt(RT)", C("pt", rt).confirmReceipt(id));
    if ((p + 1) % 25 === 0) process.stdout.write(`  ${p + 1}/${NUM_PRODUCTS} products shipped\n`);
  }
  const totalMs = Date.now() - startTime;

  // ── 3. Read-back sanity ──────────────────────────────────────────────────────
  const rdProducts = Number(await C("pt", root).totalProducts());
  const rdCompanies = Number(await C("did", root).totalDIDs());
  const rdCreds = Number(await C("cred", root).totalCredentials());

  report({ perOp, timeline, txCount, totalMs, blocks, rdProducts, rdCompanies, rdCreds, NET, chainId });
}

function report(r) {
  const line = "-".repeat(70);
  console.log("\n" + line + "\nGAS PER OPERATION\n" + line);
  console.log("operation".padEnd(28) + "count".padStart(8) + "avg gas".padStart(14) + "total gas".padStart(18));
  const gasRows = []; let grandGas = 0n;
  for (const [label, o] of Object.entries(r.perOp)) {
    const avg = o.gas / BigInt(o.count); grandGas += o.gas;
    gasRows.push({ label, count: o.count, avgGas: avg.toString(), totalGas: o.gas.toString() });
    console.log(label.padEnd(28) + String(o.count).padStart(8) + avg.toLocaleString().padStart(14) + o.gas.toLocaleString().padStart(18));
  }
  console.log(line);
  console.log("TOTAL".padEnd(28) + String(r.txCount).padStart(8) + "".padStart(14) + grandGas.toLocaleString().padStart(18));

  console.log("\n" + line + "\nTHROUGHPUT vs LOAD\n" + line);
  console.log("transactions".padStart(14) + "elapsed(s)".padStart(14) + "tx/sec".padStart(12) + "tx/min".padStart(12));
  for (const s of r.timeline) {
    const sec = s.elapsedMs / 1000;
    console.log(String(s.tx).padStart(14) + sec.toFixed(2).padStart(14) + (s.tx / sec).toFixed(1).padStart(12) + (s.tx / sec * 60).toFixed(0).padStart(12));
  }

  const sec = r.totalMs / 1000;
  console.log("\n" + line);
  console.log(`Network: ${r.NET} (chainId ${r.chainId})`);
  console.log(`Total: ${r.txCount} transactions in ${sec.toFixed(2)} s  =  ${(r.txCount / sec).toFixed(1)} tx/sec  (${(r.txCount / sec * 60).toFixed(0)} tx/min)`);
  console.log(`Spanned ${r.blocks.size} blocks  =  ${(r.txCount / r.blocks.size).toFixed(1)} tx/block avg`);
  console.log(`Read-back OK: ${r.rdCompanies} companies, ${r.rdCreds} credentials, ${r.rdProducts} products on chain.`);

  const outDir = path.join(__dirname, "..", "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const tag = r.NET;
  fs.writeFileSync(path.join(outDir, `gas-${tag}.csv`),
    "operation,count,avg_gas,total_gas\n" + gasRows.map(x => `${x.label},${x.count},${x.avgGas},${x.totalGas}`).join("\n") + "\n");
  fs.writeFileSync(path.join(outDir, `throughput-${tag}.csv`),
    "transactions,elapsed_seconds,tx_per_sec,tx_per_min\n" +
    r.timeline.map(s => { const ss = s.elapsedMs / 1000; return `${s.tx},${ss.toFixed(3)},${(s.tx / ss).toFixed(2)},${(s.tx / ss * 60).toFixed(1)}`; }).join("\n") + "\n");
  console.log(`\nWrote benchmark-results/gas-${tag}.csv and benchmark-results/throughput-${tag}.csv`);
}

main().catch(e => { console.error(e); process.exit(1); });
