// scripts/benchmark.cjs - synthetic-data load test for the paper.
//
// Builds a synthetic supply chain (many Manufacturers / Distributors / Retailers),
// runs the full product lifecycle thousands of times, and measures:
//   - gas used per operation type
//   - throughput (transactions per second / per minute) as the load grows
//   - average latency per transaction
// Writes the results to benchmark-results/*.csv for charting.
//
// Runs ONLY on a local, throwaway chain - never Besu. Nothing here survives
// stopping the local node, so it cannot pollute the live demo.
//
//   npx hardhat node                                          (terminal 1)
//   npm run deploy:local                                      (terminal 2)
//   npm run benchmark:local         (or: npx hardhat run scripts/benchmark.cjs --network localhost)
//
// Tune the size with the constants below.

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const dep = require("../src/deployment.json");

// ── Size of the synthetic supply chain ──────────────────────────────────────
const NUM_MF        = 10;   // manufacturers
const DT_PER_MF     = 1;    // distributors licensed by each manufacturer
const RT_PER_DT     = 5;    // retailers licensed by each distributor  (=> 5 retailers per MF)
const NUM_PRODUCTS  = 180;  // products created + shipped MF -> DT -> RT  (5 tx each)
const FUND_ETH      = "100"; // test ETH given to each generated wallet for gas

async function main() {
  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat")
    throw new Error("benchmark is for local chains only - never run it against Besu");

  const provider = ethers.provider;
  const [root] = await ethers.getSigners();           // deployer == rootGA on the local chain
  const C = (k, s) => new ethers.Contract(dep.contracts[k].address, dep.contracts[k].abi, s);
  const expiresAt = (await provider.getBlock("latest")).timestamp + 365 * 86400;

  // ── Metrics collection ────────────────────────────────────────────────────
  const perOp = {};            // label -> { count, gas: bigint }
  const timeline = [];         // { tx, elapsedMs } snapshot every STEP transactions
  const STEP = 100;
  let txCount = 0;
  let startTime = 0;

  function record(label, gasUsed, ms) {
    txCount++;
    const o = perOp[label] || (perOp[label] = { count: 0, gas: 0n, ms: 0 });
    o.count++; o.gas += BigInt(gasUsed); o.ms += ms;
    if (txCount % STEP === 0) timeline.push({ tx: txCount, elapsedMs: Date.now() - startTime });
  }

  // Wrap a contract call: send, wait, record its gas + wall-clock time.
  async function measure(label, call) {
    const t0 = Date.now();
    const tx = await call;
    const rc = await tx.wait();
    record(label, rc.gasUsed, Date.now() - t0);
    return rc;
  }

  // ── Generate + fund the wallets (not counted in the benchmark) ─────────────
  const totalWallets = 1 /*LG*/ + NUM_MF + NUM_MF * DT_PER_MF + NUM_MF * DT_PER_MF * RT_PER_DT;
  process.stdout.write(`Funding ${totalWallets} synthetic wallets… `);
  const wallets = [];
  for (let i = 0; i < totalWallets; i++) {
    const w = ethers.Wallet.createRandom().connect(provider);
    await (await root.sendTransaction({ to: w.address, value: ethers.parseEther(FUND_ETH) })).wait();
    wallets.push(w);
  }
  let idx = 0;
  const next = () => wallets[idx++];
  const lg = next();
  const mfs = Array.from({ length: NUM_MF }, next);
  const dts = Array.from({ length: NUM_MF * DT_PER_MF }, next);
  const rts = Array.from({ length: NUM_MF * DT_PER_MF * RT_PER_DT }, next);
  console.log("done.");

  console.log(`Synthetic chain: 1 LG, ${mfs.length} MF, ${dts.length} DT, ${rts.length} RT; ${NUM_PRODUCTS} products.`);
  console.log("Running… (local chain, mined instantly)\n");
  startTime = Date.now();

  // ── 1. Register + license everyone ─────────────────────────────────────────
  await measure("registerLocalGovt", C("did", root).registerLocalGovt(lg.address, "Benchmark LG", "Benchmark Region"));
  await measure("authorizeIssuer",   C("trust", root).authorizeIssuer(lg.address, "LocalGovt"));

  for (let i = 0; i < mfs.length; i++)
    await measure("registerDID(MF)", C("did", mfs[i]).registerDID("Manufacturer", `Manufacturer ${i}`));
  for (let i = 0; i < dts.length; i++)
    await measure("registerDID(DT)", C("did", dts[i]).registerDID("Distributor", `Distributor ${i}`));
  for (let i = 0; i < rts.length; i++)
    await measure("registerDID(RT)", C("did", rts[i]).registerDID("Retailer", `Retailer ${i}`));

  // LG -> each MF
  for (const mf of mfs)
    await measure("issueCredential(LG->MF)", C("cred", lg).issueCredential(mf.address, expiresAt));
  // each MF -> its DT(s)
  for (let i = 0; i < mfs.length; i++)
    for (let d = 0; d < DT_PER_MF; d++)
      await measure("issueCredential(MF->DT)", C("cred", mfs[i]).issueCredential(dts[i * DT_PER_MF + d].address, expiresAt));
  // each DT -> its RT(s)
  for (let i = 0; i < dts.length; i++)
    for (let r = 0; r < RT_PER_DT; r++)
      await measure("issueCredential(DT->RT)", C("cred", dts[i]).issueCredential(rts[i * RT_PER_DT + r].address, expiresAt));

  // ── 2. Product lifecycle: create -> ship to DT -> confirm -> ship to RT -> confirm ──
  const createdEvt = C("pt", root).interface.getEvent("ProductCreated").topicHash;
  for (let p = 0; p < NUM_PRODUCTS; p++) {
    const mfIdx = p % NUM_MF;
    const mf = mfs[mfIdx];
    const dt = dts[mfIdx * DT_PER_MF];                                   // this MF's distributor
    const rt = rts[(mfIdx * DT_PER_MF) * RT_PER_DT + (p % RT_PER_DT)];   // one of that DT's 5 retailers

    const rc = await measure("createProduct",
      C("pt", mf).createProduct(`Product ${p}`, "", 100, `Synthetic product ${p}`, `B-${mfIdx}-${p}`, 15));
    const log = rc.logs.find(l => l.topics[0] === createdEvt);
    const id = C("pt", mf).interface.parseLog(log).args.id;

    await measure("shipTo(MF->DT)",   C("pt", mf).shipTo(id, dt.address));
    await measure("confirmReceipt(DT)", C("pt", dt).confirmReceipt(id));
    await measure("shipTo(DT->RT)",   C("pt", dt).shipTo(id, rt.address));
    await measure("confirmReceipt(RT)", C("pt", rt).confirmReceipt(id));
  }

  const totalMs = Date.now() - startTime;

  // ── 3. Sanity check: can we still read the whole dataset back? ──────────────
  const rdProducts = Number(await C("pt", root).totalProducts());
  const rdCompanies = Number(await C("did", root).totalDIDs());
  const rdCreds = Number(await C("cred", root).totalCredentials());

  // ── Report ──────────────────────────────────────────────────────────────────
  const line = "─".repeat(64);
  console.log("\n" + line + "\nGAS PER OPERATION\n" + line);
  console.log("operation".padEnd(28) + "count".padStart(8) + "avg gas".padStart(14) + "total gas".padStart(16));
  const gasRows = [];
  let grandGas = 0n;
  for (const [label, o] of Object.entries(perOp)) {
    const avg = o.gas / BigInt(o.count);
    grandGas += o.gas;
    gasRows.push({ label, count: o.count, avgGas: avg.toString(), totalGas: o.gas.toString() });
    console.log(label.padEnd(28) + String(o.count).padStart(8) + avg.toLocaleString().padStart(14) + o.gas.toLocaleString().padStart(16));
  }
  console.log(line);
  console.log(`TOTAL`.padEnd(28) + String(txCount).padStart(8) + "".padStart(14) + grandGas.toLocaleString().padStart(16));

  console.log("\n" + line + "\nTHROUGHPUT (local chain - timing is a lower bound, not a real network)\n" + line);
  console.log("transactions".padStart(14) + "elapsed(s)".padStart(14) + "tx/sec".padStart(12) + "tx/min".padStart(12));
  for (const s of timeline) {
    const sec = s.elapsedMs / 1000;
    console.log(String(s.tx).padStart(14) + sec.toFixed(2).padStart(14) + (s.tx / sec).toFixed(1).padStart(12) + (s.tx / sec * 60).toFixed(0).padStart(12));
  }
  console.log(line);
  console.log(`\nTotal: ${txCount} transactions in ${(totalMs / 1000).toFixed(2)} s  =  ${(txCount / (totalMs / 1000)).toFixed(1)} tx/sec  (${(txCount / (totalMs / 1000) * 60).toFixed(0)} tx/min)`);
  console.log(`Read-back OK: ${rdCompanies} companies, ${rdCreds} credentials, ${rdProducts} products on chain.`);

  // ── Write CSVs ───────────────────────────────────────────────────────────────
  const outDir = path.join(__dirname, "..", "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "gas.csv"),
    "operation,count,avg_gas,total_gas\n" + gasRows.map(r => `${r.label},${r.count},${r.avgGas},${r.totalGas}`).join("\n") + "\n");
  fs.writeFileSync(path.join(outDir, "throughput.csv"),
    "transactions,elapsed_seconds,tx_per_sec,tx_per_min\n" +
    timeline.map(s => { const sec = s.elapsedMs / 1000; return `${s.tx},${sec.toFixed(3)},${(s.tx / sec).toFixed(2)},${(s.tx / sec * 60).toFixed(1)}`; }).join("\n") + "\n");
  console.log(`\nWrote benchmark-results/gas.csv and benchmark-results/throughput.csv`);
}

main().catch(e => { console.error(e); process.exit(1); });
