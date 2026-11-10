import { useState } from 'react'
import { hasWallet, CHAIN_NAME } from '../lib/chain'
import { errMsg } from '../lib/format'
import { Alert, Button } from '../components/ui'

export default function Connect({ onConnect }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    setBusy(true); setErr('')
    try { await onConnect() } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-hero">
          <div className="auth-logo">🔗</div>
          <h1 className="auth-title">DIDLab Supply Chain</h1>
          <p className="auth-sub">Blockchain-verified product traceability with decentralized identities and verifiable licences.</p>
        </div>
        <div className="card-body stack">
          <div className="feature-list">
            <div className="feature">🪪 <span><b>One identity per company</b> — your DID and company name live on-chain.</span></div>
            <div className="feature">🏛️ <span><b>Chain of trust</b> — Root Authority → Local Government → Manufacturer → Distributor → Retailer.</span></div>
            <div className="feature">📦 <span><b>Licensed handoffs</b> — products only move between partners you licensed.</span></div>
            <div className="feature">🔍 <span><b>Public verification</b> — anyone can scan a QR code to verify a product.</span></div>
          </div>
          {err && <Alert type="error">{err}</Alert>}
          {!hasWallet() ? (
            <Alert type="warning" title="MetaMask required">
              Install the <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask extension</a>, then reload this page.
            </Alert>
          ) : (
            <Button size="lg" block loading={busy} onClick={go}>🦊 Connect MetaMask</Button>
          )}
          <p className="faint small center">You'll be asked to switch to the <b>{CHAIN_NAME}</b> network if needed.</p>
        </div>
      </div>
    </div>
  )
}
