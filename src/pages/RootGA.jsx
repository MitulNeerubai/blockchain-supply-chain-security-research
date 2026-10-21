import { useState } from "react";
import { getContract } from "../contracts";

export default function RootGA({ signer }) {
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");

  async function authorize() {
    if (!signer) return setStatus("❌ Connect wallet first");
    if (!address || !name) return setStatus("❌ Fill in both fields");
    try {
      setStatus("⏳ Sending transaction...");
      const trust = getContract("TrustRegistry", signer);
      const tx = await trust.authorizeIssuer(address, name);
      setStatus("⏳ Waiting for confirmation...");
      await tx.wait();
      setStatus(`✅ ${name} (${address.slice(0,6)}...) authorized!`);
      setAddress(""); setName("");
    } catch (err) {
      setStatus("❌ Error: " + err.message.split("(")[0]);
    }
  }

  async function revoke() {
    if (!signer) return setStatus("❌ Connect wallet first");
    if (!address) return setStatus("❌ Enter address to revoke");
    try {
      setStatus("⏳ Sending transaction...");
      const trust = getContract("TrustRegistry", signer);
      const tx = await trust.revokeIssuer(address);
      await tx.wait();
      setStatus(`✅ ${address.slice(0,6)}... revoked`);
      setAddress("");
    } catch (err) {
      setStatus("❌ Error: " + err.message.split("(")[0]);
    }
  }

  return (
    <div>
      <h2>🏛️ Governance Authority</h2>
      <p style={{ color: "#6b7280" }}>Authorize or revoke issuers in the TrustRegistry.</p>

      <div style={card}>
        <label style={lbl}>Issuer Address</label>
        <input style={inp} value={address} onChange={e => setAddress(e.target.value)}
          placeholder="0x..." />

        <label style={lbl}>Role Name</label>
        <input style={inp} value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Manufacturer" />

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button onClick={authorize} style={btn("#1a56db")}>Authorize Issuer</button>
          <button onClick={revoke} style={btn("#c81e1e")}>Revoke Issuer</button>
        </div>

        {status && <p style={{ marginTop: 12, fontWeight: 500 }}>{status}</p>}
      </div>
    </div>
  );
}

const card = { border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, background: "#fff" };
const lbl = { display: "block", fontSize: 13, color: "#6b7280", marginBottom: 4, marginTop: 12 };
const inp = { width: "100%", padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, boxSizing: "border-box" };
const btn = bg => ({ padding: "10px 18px", background: bg, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 });
