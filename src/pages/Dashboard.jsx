import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { ADDRESSES, ABIS } from "../contracts";

const STATUS = ["Created", "In Transit", "Delivered", "Revoked"];

export default function Dashboard() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    try {
      const provider = new ethers.JsonRpcProvider("https://eth.didlab.org");
      const pt = new ethers.Contract(ADDRESSES.ProductTransfer, ABIS.ProductTransfer, provider);
      const total = await pt.totalProducts();
      const list = [];
      for (let i = 1n; i <= total; i++) {
        const p = await pt.getProduct(i);
        list.push(p);
      }
      setProducts(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p>Loading products from blockchain...</p>;

  return (
    <div>
      <h2>📦 All Products</h2>
      <button onClick={loadProducts} style={btn}>Refresh</button>
      {products.length === 0 && <p>No products found.</p>}
      {products.map((p, i) => (
        <div key={i} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>#{p.id.toString()} — {p.name}</b>
            <span style={{ background: p.status === 2n ? "#def7ec" : "#dbeafe",
              color: p.status === 2n ? "#057a55" : "#1e40af",
              padding: "2px 10px", borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
              {STATUS[Number(p.status)]}
            </span>
          </div>
          <p style={{ color: "#6b7280", fontSize: 13, margin: "6px 0 0" }}>
            Holder: {p.currentHolder.slice(0,6)}...{p.currentHolder.slice(-4)} &nbsp;|&nbsp;
            MF: {p.manufacturer.slice(0,6)}...{p.manufacturer.slice(-4)}
          </p>
        </div>
      ))}
    </div>
  );
}

const card = {
  border: "1px solid #e5e7eb", borderRadius: 10, padding: 16,
  marginBottom: 12, background: "#fff"
};
const btn = {
  marginBottom: 16, padding: "8px 16px", background: "#1a56db",
  color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600
};
