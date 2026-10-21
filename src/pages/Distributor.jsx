import { useState } from "react";
import { ethers } from "ethers";
import { getContract } from "../contracts";

export default function Distributor({ signer }) {
  const [claimProductId, setClaimProductId] = useState("");
  const [claimSecret, setClaimSecret] = useState("");
  const [commitProductId, setCommitProductId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [secret, setSecret] = useState("");
  const [transferCredId, setTransferCredId] = useState("");
  const [rtHolder, setRtHolder] = useState("");
  const [status, setStatus] = useState("");

  const s = {
    card: {border:"1px solid #e5e7eb",borderRadius:10,padding:20,background:"#fff",marginBottom:16},
    inp: {width:"100%",padding:"9px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:14,boxSizing:"border-box"},
    lbl: {display:"block",fontSize:13,color:"#6b7280",marginBottom:4,marginTop:12},
    btn: (bg) => ({marginTop:14,padding:"10px 18px",background:bg,color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:600}),
  };

  async function issueLicense() {
    if (!signer || !rtHolder) return setStatus("❌ Connect wallet and enter address");
    try {
      setStatus("⏳ Issuing TradeLicense...");
      const cred = getContract("CredentialRegistry", signer);
      const tx = await cred.issueCredential(rtHolder, "TradeLicense", 180);
      await tx.wait();
      setStatus(`✅ TradeLicense issued to ${rtHolder.slice(0,6)}...`);
      setRtHolder("");
    } catch (err) { setStatus("❌ " + err.message.split("(")[0]); }
  }

  async function claimTransfer() {
    if (!signer || !claimProductId || !claimSecret) return setStatus("❌ Fill in product ID and secret");
    try {
      setStatus("⏳ Claiming transfer...");
      const pt = getContract("ProductTransfer", signer);
      const tx = await pt.claimTransfer(BigInt(claimProductId), claimSecret);
      await tx.wait();
      setStatus(`✅ Product #${claimProductId} claimed!`);
      setClaimProductId(""); setClaimSecret("");
    } catch (err) { setStatus("❌ " + err.message.split("(")[0]); }
  }

  async function commitTransfer() {
    if (!signer || !commitProductId || !secret || !recipient || !transferCredId)
      return setStatus("❌ Fill in all fields");
    try {
      setStatus("⏳ Committing transfer...");
      const pt = getContract("ProductTransfer", signer);
      const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
      const tx = await pt.commitTransfer(BigInt(commitProductId), secretHash, recipient, transferCredId);
      await tx.wait();
      setStatus(`✅ Transfer committed! Share secret "${secret}" with retailer.`);
    } catch (err) { setStatus("❌ " + err.message.split("(")[0]); }
  }

  return (
    <div>
      <h2>🚚 Distributor</h2>
      <div style={s.card}>
        <h3>Issue TradeLicense to Retailer</h3>
        <label style={s.lbl}>Retailer Address</label>
        <input style={s.inp} value={rtHolder} onChange={e=>setRtHolder(e.target.value)} placeholder="0x..." />
        <button onClick={issueLicense} style={s.btn("#1a56db")}>Issue License</button>
      </div>
      <div style={s.card}>
        <h3>Claim Transfer from Manufacturer</h3>
        <label style={s.lbl}>Product ID</label>
        <input style={s.inp} value={claimProductId} onChange={e=>setClaimProductId(e.target.value)} placeholder="e.g. 1" />
        <label style={s.lbl}>Secret (from manufacturer)</label>
        <input style={s.inp} value={claimSecret} onChange={e=>setClaimSecret(e.target.value)} placeholder="HANDSHAKE_..." />
        <button onClick={claimTransfer} style={s.btn("#1a56db")}>Claim Transfer</button>
      </div>
      <div style={s.card}>
        <h3>Commit Transfer to Retailer</h3>
        <label style={s.lbl}>Product ID</label>
        <input style={s.inp} value={commitProductId} onChange={e=>setCommitProductId(e.target.value)} placeholder="e.g. 1" />
        <label style={s.lbl}>Retailer Address</label>
        <input style={s.inp} value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x..." />
        <label style={s.lbl}>Secret (share with retailer)</label>
        <input style={s.inp} value={secret} onChange={e=>setSecret(e.target.value)} placeholder="HANDSHAKE_..." />
        <label style={s.lbl}>Retailer Credential ID</label>
        <input style={s.inp} value={transferCredId} onChange={e=>setTransferCredId(e.target.value)} placeholder="0x..." />
        <button onClick={commitTransfer} style={s.btn("#1a56db")}>Commit Transfer</button>
      </div>
      {status && <p style={{marginTop:12,fontWeight:500}}>{status}</p>}
    </div>
  );
}
