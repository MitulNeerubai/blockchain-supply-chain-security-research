import { useState } from "react";
import { getContract } from "../contracts";

export default function LocalGovt({ signer }) {
  const [holder, setHolder] = useState("");
  const [credType, setCredType] = useState("ManufacturingLicense");
  const [days, setDays] = useState("365");
  const [status, setStatus] = useState("");
  const [credId, setCredId] = useState("");

  async function issueCredential() {
    if (!signer) return setStatus("❌ Connect wallet first");
    if (!holder) return setStatus("❌ Enter holder address");
    try {
      setStatus("⏳ Sending transaction...");
      const cred = getContract("CredentialRegistry", signer);
      const tx = await cred.issueCredential(holder, credType, Number(days));
      setStatus("⏳ Waiting for confirmation...");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map(l => { try { return cred.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "CredentialIssued");
      setCredId(event?.args?.credentialId || "check tx");
      setStatus(`✅ ${credType} issued!`);
      setHolder("");
    } catch (err) {
      setStatus("❌ " + err.message.split("(")[0]);
    }
  }

  return (
    <div>
      <h2>🏛️ Local Government</h2>
      <div style={{border:"1px solid #e5e7eb",borderRadius:10,padding:20,background:"#fff"}}>
        <label style={{display:"block",fontSize:13,color:"#6b7280",marginBottom:4}}>Holder Address</label>
        <input style={{width:"100%",padding:"9px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:14,boxSizing:"border-box"}} value={holder} onChange={e=>setHolder(e.target.value)} placeholder="0x..." />
        <label style={{display:"block",fontSize:13,color:"#6b7280",marginBottom:4,marginTop:12}}>Credential Type</label>
        <select style={{width:"100%",padding:"9px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:14,boxSizing:"border-box"}} value={credType} onChange={e=>setCredType(e.target.value)}>
          <option>ManufacturingLicense</option>
          <option>GovtAuthority</option>
          <option>TradeLicense</option>
        </select>
        <label style={{display:"block",fontSize:13,color:"#6b7280",marginBottom:4,marginTop:12}}>Valid for (days)</label>
        <input style={{width:"100%",padding:"9px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:14,boxSizing:"border-box"}} type="number" value={days} onChange={e=>setDays(e.target.value)} />
        <button onClick={issueCredential} style={{marginTop:14,padding:"10px 18px",background:"#1a56db",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:600}}>Issue Credential</button>
        {status && <p style={{marginTop:12,fontWeight:500}}>{status}</p>}
        {credId && <p style={{fontSize:12,wordBreak:"break-all",fontFamily:"monospace",background:"#f9fafb",padding:10,borderRadius:8}}>Credential ID: {credId}</p>}
      </div>
    </div>
  );
}
