import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContract } from "../contracts";

export default function RegisterDID({ signer, account }) {
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [currentDID, setCurrentDID] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (account && signer) checkDID();
  }, [account, signer]);

  async function checkDID() {
    try {
      const did = getContract("DIDRegistry", signer);
      const doc = await did.getDocument(account);
      if (doc.active) {
        setCurrentDID({ did: doc.did, role: doc.role });
      } else {
        setCurrentDID(null);
      }
    } catch (e) {
      setCurrentDID(null);
    }
  }

  async function registerDID() {
    if (!role.trim()) return setStatus("❌ Enter a role name");
    try {
      setLoading(true);
      setStatus("⏳ Sending transaction...");
      const did = getContract("DIDRegistry", signer);
      const tx = await did.registerDID(role.trim());
      setStatus("⏳ Waiting for confirmation...");
      await tx.wait();
      setStatus("✅ DID registered successfully!");
      checkDID();
    } catch (e) {
      setStatus("❌ " + (e.reason || e.message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h2>🪪 Register DID</h2>

      {currentDID ? (
        <div style={{ background: "#e6ffe6", border: "1px solid #4caf50", borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <strong>✅ DID already registered</strong>
          <p style={{ margin: "8px 0 0", wordBreak: "break-all" }}><strong>DID:</strong> {currentDID.did}</p>
          <p style={{ margin: "4px 0 0" }}><strong>Role:</strong> {currentDID.role}</p>
        </div>
      ) : (
        <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <strong>⚠️ No DID registered for this wallet</strong>
          <p style={{ margin: "8px 0 0", fontSize: 13 }}>You must be authorized by rootGA first, then register your DID before doing anything else.</p>
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Register New DID</h3>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Role Name</label>
        <input
          value={role}
          onChange={e => setRole(e.target.value)}
          placeholder="e.g. LocalGovt, Manufacturer, Distributor, Retailer"
          style={{ width: "100%", padding: "10px", borderRadius: 6, border: "1px solid #ccc", marginBottom: 16, boxSizing: "border-box" }}
        />
        <button
          onClick={registerDID}
          disabled={loading || !!currentDID}
          style={{ width: "100%", padding: "12px", background: currentDID ? "#ccc" : "#4caf50", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 15, cursor: currentDID ? "not-allowed" : "pointer" }}
        >
          {currentDID ? "Already Registered" : "Register DID"}
        </button>
        {status && (
          <p style={{ marginTop: 12, padding: 10, background: "#f5f5f5", borderRadius: 6, wordBreak: "break-all" }}>{status}</p>
        )}
      </div>

      <div style={{ marginTop: 20, background: "#f0f4ff", border: "1px solid #c0d0ff", borderRadius: 8, padding: 16, fontSize: 13 }}>
        <strong>📋 First-time setup order:</strong>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>rootGA authorizes your wallet (RootGA page)</li>
          <li>You register your DID here (this page)</li>
          <li>LG issues you a credential (Local Govt page)</li>
          <li>You can now create products / transfer</li>
        </ol>
      </div>
    </div>
  );
}
