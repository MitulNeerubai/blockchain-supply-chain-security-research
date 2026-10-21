import { useState } from "react";
import { ethers } from "ethers";
import { getContract } from "../contracts";

export default function Manufacturer({ signer }) {
  const [productName, setProductName] = useState("");
  const [mfCredId, setMfCredId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [secret, setSecret] = useState("");
  const [transferCredId, setTransferCredId] = useState("");
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState("");

  async function createProduct() {
    if (!signer) return setStatus("❌ Connect wallet first");
    if (!productName || !mfCredId) return setStatus("❌ Fill in product name and credential ID");
    try {
      setStatus("⏳ Creating product on blockchain...");
      const pt = getContract("ProductTransfer", signer);
      const tx = await pt.createProduct(productName, mfCredId);
      setStatus("⏳ Waiting for confirmation...");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map(l => { try { return pt.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "ProductCreated");
      const id = event?.args?.productId?.toString() || "unknown";
      setProductId(id);
      setStatus(`✅ Product created! ID: ${id}`);
      setProductName("");
    } catch (err) {
      setStatus("❌ Error: " + err.message.split("(")[0]);
    }
  }

  async function commitTransfer() {
    if (!signer) return setStatus("❌ Connect wallet first");
    if (!productId || !secret || !recipient || !transferCredId)
      return setStatus("❌ Fill in all transfer fields");
    try {
      setStatus("⏳ Committing transfer...");
      const pt = getContract("ProductTransfer", signer);
      const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
      const tx = await pt.commitTransfer(BigInt(productId), secretHash, recipient, transferCredId);
      await tx.wait();
      setStatus(`✅ Transfer committed! Share secret "${secret}" with distributor off-chain.`);
    } catch (err) {
      setStatus("❌ Error: " + err.message.split("(")[0]);
    }
  }

  return (
    <div>
      <h2>🏭 Manufacturer</h2>

      <div style={card}>
        <h3 style={{ marginBottom: 4 }}>Create Product</h3>
        <label style={lbl}>Product Name</label>
        <input style={inp} value={productName} onChange={e => setProductName(e.target.value)}
          placeholder="e.g. Widget-Alpha-001" />

        <label style={lbl}>Manufacturing Credential ID</label>
        <input style={inp} value={mfCredId} onChange={e => setMfCredId(e.target.value)}
          placeholder="0x... (from LG page)" />

        <button onClick={createProduct} style={{ ...btn, marginTop: 14 }}>
          Create Product
        </button>
      </div>

      <div style={card}>
        <h3 style={{ marginBottom: 4 }}>Commit Transfer to Distributor</h3>
        <label style={lbl}>Product ID</label>
        <input style={inp} value={productId} onChange={e => setProductId(e.target.value)}
          placeholder="e.g. 1" />

        <label style={lbl}>Recipient Address (Distributor)</label>
        <input style={inp} value={recipient} onChange={e => setRecipient(e.target.value)}
          placeholder="0x..." />

        <label style={lbl}>Secret (share off-chain with distributor)</label>
        <input style={inp} value={secret} onChange={e => setSecret(e.target.value)}
          placeholder="e.g. HANDSHAKE_MF_DT_001" />

        <label style={lbl}>Distributor's Credential ID</label>
        <input style={inp} value={transferCredId} onChange={e => setTransferCredId(e.target.value)}
          placeholder="0x..." />

        <button onClick={commitTransfer} style={{ ...btn, marginTop: 14 }}>
          Commit Transfer
        </button>
      </div>

      {status && <p style={{ marginTop: 12, fontWeight: 500 }}>{status}</p>}
    </div>
  );
}

const card = { border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, background: "#fff", marginBottom: 16 };
const lbl = { display: "block", fontSize: 13, color: "#6b7280", marginBottom: 4, marginTop: 12 };
const inp = { width: "100%", padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, boxSizing: "border-box" };
const btn = { padding: "10px 18px", background: "#1a56db", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 };
