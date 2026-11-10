import { useState } from 'react'
import { hasWallet, CHAIN_NAME } from '../lib/chain'
import { Alert, Button } from '../components/ui'

export default function Connect({ onConnect }) {
  const [busy, setBusy] = useState(false)

  async function connect() {
    setBusy(true)
    try { await onConnect() } catch { /* shown by the wallet error banner */ }
    setBusy(false)
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-hero">
          <div className="auth-logo">🔗</div>
          <h1 className="auth-title">Participant sign-in</h1>
          <p className="auth-sub">For companies that create, ship, sell or license products. Just browsing? You don't need a wallet — use <a href="#/">Overview</a>, <a href="#/products">Products</a> or <a href="#/verify">Verify</a>.</p>
        </div>
        <div className="card-body stack">
          <div className="feature-list">
            <div className="feature">🪪 <span><b>One identity per company</b> — your DID and company name live on-chain.</span></div>
            <div className="feature">🏛️ <span><b>Chain of trust</b> — Root Authority → Local Government → Manufacturer → Distributor → Retailer.</span></div>
            <div className="feature">📦 <span><b>Licensed handoffs</b> — products only move between partners you licensed.</span></div>
            <div className="feature">🧭 <span><b>Guided</b> — after you register, a checklist walks you through every next step.</span></div>
          </div>
          {!hasWallet() ? (
            <Alert type="warning" title="MetaMask required to sign in">
              Install the <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask extension</a>, then reload this page. See <a href="#/guide">How it works</a> for the network settings.
            </Alert>
          ) : (
            <Button size="lg" block loading={busy} onClick={connect}>🦊 Connect MetaMask</Button>
          )}
          <p className="faint small center">You'll be asked to switch to the <b>{CHAIN_NAME}</b> network if needed.</p>
        </div>
      </div>
    </div>
  )
}
