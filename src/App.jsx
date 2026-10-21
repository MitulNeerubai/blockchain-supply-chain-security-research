import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { BESU_NETWORK } from "./contracts";
import Dashboard from "./pages/Dashboard";
import RootGA from "./pages/RootGA";
import LocalGovt from "./pages/LocalGovt";
import Manufacturer from "./pages/Manufacturer";
import Distributor from "./pages/Distributor";
import Retailer from "./pages/Retailer";
import RegisterDID from "./pages/RegisterDID";

const ROLES = {};

export default function App() {
  const [account, setAccount] = useState(null);
  const [signer, setSigner]   = useState(null);
  const [role, setRole]       = useState("unknown");
  const [page, setPage]       = useState("dashboard");
  const [error, setError]     = useState("");

  async function connect() {
    if (!window.ethereum) return setError("MetaMask not found! Please install it.");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BESU_NETWORK.chainId }] });
      } catch (sw) {
        if (sw.code === 4902) await window.ethereum.request({ method: "wallet_addEthereumChain", params: [BESU_NETWORK] });
      }
      const s = await provider.getSigner();
      const acc = (await s.getAddress()).toLowerCase();
      setSigner(s);
      setAccount(acc);
      setRole(ROLES[acc] || "unknown");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.on("accountsChanged", () => connect());
    window.ethereum.on("chainChanged", () => connect());
  }, []);

  const nav = [
    { id: "dashboard",    label: "📦 Dashboard" },
    { id: "register-did", label: "🪪 Register DID" },
    { id: "rootga",       label: "🏛️ RootGA" },
    { id: "lg",           label: "🏛️ Local Govt" },
    { id: "manufacturer", label: "🏭 Manufacturer" },
    { id: "distributor",  label: "🚚 Distributor" },
    { id: "retailer",     label: "🏪 Retailer" },
  ];

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", background: "#f5f7fa" }}>
      <div style={{ background: "#1a1a2e", color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>🔗 SSI Supply Chain</h1>
        {account ? (
          <span style={{ fontSize: 13, background: "#16213e", padding: "6px 12px", borderRadius: 20 }}>
            ✅ Connected: {account.slice(0,6)}...{account.slice(-4)} — Role: {role}
          </span>
        ) : (
          <button onClick={connect} style={{ padding: "8px 16px", background: "#e94560", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>
            Connect MetaMask
          </button>
        )}
      </div>

      {error && <div style={{ background: "#ffebee", color: "#c62828", padding: "10px 24px", fontSize: 13 }}>❌ {error}</div>}

      <div style={{ background: "#16213e", display: "flex", gap: 4, padding: "8px 16px", flexWrap: "wrap" }}>
        {nav.map(n => (
          <button key={n.id} onClick={() => setPage(n.id)}
            style={{ padding: "8px 14px", background: page === n.id ? "#e94560" : "transparent", color: "#fff", border: "1px solid #444", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            {n.label}
          </button>
        ))}
      </div>

      <div style={{ padding: 24 }}>
        {!account ? (
          <div style={{ textAlign: "center", marginTop: 80 }}>
            <h2>Connect your MetaMask wallet to get started</h2>
            <button onClick={connect} style={{ padding: "12px 32px", background: "#e94560", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 16 }}>
              Connect MetaMask
            </button>
          </div>
        ) : (
          <>
            {page === "dashboard"    && <Dashboard signer={signer} account={account} />}
            {page === "register-did" && <RegisterDID signer={signer} account={account} />}
            {page === "rootga"       && <RootGA signer={signer} account={account} />}
            {page === "lg"           && <LocalGovt signer={signer} account={account} />}
            {page === "manufacturer" && <Manufacturer signer={signer} account={account} />}
            {page === "distributor"  && <Distributor signer={signer} account={account} />}
            {page === "retailer"     && <Retailer signer={signer} account={account} />}
          </>
        )}
      </div>
    </div>
  );
}
