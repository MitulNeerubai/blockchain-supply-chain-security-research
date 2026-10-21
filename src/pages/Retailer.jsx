import { useState } from "react";
import { ethers } from "ethers";
import { getContract, ADDRESSES, ABIS } from "../contracts";

export default function Retailer({ signer }) {
  const [productId, setProductId] = useState("");
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState(null);

  async function claimTransfer() {
    if (!signer) return setStatus("❌ Connect wallet first");
    if (!productId || !secret) return setStatus("❌ Fill in product ID and secret");
    try {
      setStatus("⏳ Claiming transfer...");
      const pt = getContract("ProductTransfer", signer);
      const tx = await pt.claimTransfer(BigInt(productId), secret);
      await tx.wait();
      setStatus(`✅ Product #${productId} claimed — delivery complete!`);
      setSecret("");
      loadProduct();
    } catch (err) {
      setStatus("❌ Error: " + err.message.split("(")[0]);
    }
  }

  async function loadProduct() {
    if (!productId) return;
    try {
      const provider = new ethers.JsonRpcProvider("https://eth.didlab.org");
      const pt = new ethers.Contract(ADDRESSES.ProductTransfer, ABIS.ProductTransfer, provider);
      const p = await pt.getProduct(BigInt(productId));
      setProduct(p);
    } catch (err) {
      setStatus("❌ Could not load product: " + err.message.split("(")[0]);
    }
  }

  const STATUS = ["Created", "In Transit", "Delivered", "Revoked"];

  return (
    <div>
      <h2>🏪 Retailer</h2>

      <div style={card}>
        <h3 style={{ marginBottom: 4 }}>Claim Transfer from Distributor</h3>
        <label style={lbl}>Product ID</label>
        <input style={inp} value={productId} onChange={e => setProductId(e.target.value)}
          placeholder="e.g. 1" />

        <label style={lbl}>Secret (from distributor)</label>
        <input style={inp} value={secret} onChange={e => setSecret(e.target.value)}
          placeholder="e.g. HANDSHAKE_DT_RT_001" />

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={claimTransfer} style={btn("#1a56db")}>Claim Transfer</button>
          <button onClick={loadProduct} style={btn("#6b7280")}>Check Product</button>
        </div>

        {status && <p style={{ marginTop: 12, fontWeight: 500 }}>{status}</p>}
      </div>

      {product && (
        <div style={{ ...card, background: "#f0fdf4", borderColor: "#86efac" }}>
          <h3 style={{ color: "#057a55" }}>📦 Product Details</h3>
          <p><b>Name:</b> {product.name}</p>
          <p><b>ID:</b> {product.id.toString()}</p>
          <p><b>Status:</b> {STATUS[Number(product.status)]}</p>
          <p><b>Current Holder:</b> {product.currentHolder}</p>
          <p><b>Manufacturer:</b> {product.manufacturer}</p>
        </div>
      )}
    </div>
  );
}

const card = { border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, background: "#fff", marginBottom: 16 };
const lbl = { display: "block", fontSize: 13, color: "#6b7280", marginBottom: 4, marginTop: 12 };
const inp = { width: "100%", padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, boxSizing: "border-box" };
const btn = bg => ({ padding: "10px 18px", background: bg, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 });
