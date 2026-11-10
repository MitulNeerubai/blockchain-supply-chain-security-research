import { useState } from 'react'
import { CHAIN_ID, CHAIN_NAME, IS_BESU, RPC_URL } from '../lib/chain'
import { go } from '../lib/app'
import { LIFECYCLE, ROLE_GUIDE } from '../lib/guide'
import { ROLE_ICON, ROLE_LABEL } from '../lib/format'
import { Button, Card, CopyButton, Tabs } from '../components/ui'

const VISITOR = [
  ['Overview', '/', 'Live numbers, the newest products, recent on-chain activity and the trust map.'],
  ['Products', '/products', 'Every product ever created: search by name, batch, number or company; filter by status. Click a row for its full history.'],
  ['Companies', '/companies', 'Every registered account with a coloured status dot (green active · amber pending/suspended · red revoked · grey expired). Click any company name anywhere to open its profile.'],
  ['Verify', '/verify', 'Type a product number or scan its QR code to see whether the chain Manufacturer → Distributor → Retailer is verified.'],
]

const FAQ = [
  ['Do I need a wallet to look around?', 'No. Overview, Products, Companies, Verify and this guide read the blockchain directly. A wallet (MetaMask) is only needed to take actions as a company.'],
  ['A manufacturer created a product by mistake — can it be deleted?', 'Yes, from the Manufacturer dashboard → Products → “🗑 Delete”, as long as the product is still in the manufacturer’s stock and was never accepted by a distributor. The record stays on-chain marked “Deleted”, but the product can no longer move.'],
  ['Which product fields are required?', 'Name, quantity (≥ 1), batch number and description. The form shows what is missing and the smart contract rejects incomplete products as well.'],
  ['Can a distributor work for several manufacturers?', 'Yes. Each manufacturer issues its own Trade License. The distributor dashboard shows one box per manufacturer, and products of a manufacturer can only be shipped while the licence from that manufacturer is active.'],
  ['How do returns work?', 'A retailer can send a product back to the distributor that shipped it, and a distributor back to the manufacturer (“↩ Return”). A reason is required and stored on-chain. The receiver accepts it under Incoming (distributor) or Returns (manufacturer).'],
  ['What happens when a licence is revoked or expires?', 'Shipments to that company can no longer be accepted. An in-transit shipment reverts to the sender with a note such as “licence of X was revoked” — automatically when the keeper service is running, or with the “⤺ Call back” button. A product already held by that company can be called back upstream the same way. A manufacturer’s own stock is frozen (not destroyed) until its licence is restored.'],
  ['Why does every handoff need two steps?', 'The sender ships, the receiver accepts. Custody only changes when the receiver confirms, so nobody can push goods onto a company without its consent and the history shows exactly who held what and when.'],
  ['What does “verified” mean on a product page?', 'The product reached a retailer through Manufacturer → Distributor → Retailer, and each handoff was licensed at the moment it happened. If a licence was revoked later, the page still shows “verified” but warns that the licence has changed since delivery.'],
]

export default function Guide() {
  const [role, setRole] = useState('Manufacturer')
  const g = ROLE_GUIDE[role]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">How it works</h1>
          <p className="page-sub">A complete walkthrough — for visitors with no wallet, and for each company role step by step.</p>
        </div>
      </div>

      <div className="stack" style={{ gap: 20 }}>
        <Card title="1 · Just looking? No wallet needed" subtitle="Everything below is public and read live from the blockchain.">
          <ol className="guide-list">
            {VISITOR.map(([t, path, txt]) => (
              <li key={t}><a href={'#' + path}><b>{t}</b></a> — {txt}</li>
            ))}
          </ol>
        </Card>

        <Card title="2 · The chain of trust" subtitle="Who licenses whom. A licence is only valid while the issuer's own licence is valid (cascading revocation).">
          <div className="flow">
            {['RootGA', 'LocalGovt', 'Manufacturer', 'Distributor', 'Retailer'].map((r, i) => (
              <div key={r} className="flow-step">
                {i > 0 && <span className="flow-arrow">→</span>}
                <div className="flow-node" style={{ borderColor: `var(--role-${r})` }}>
                  <div className="flow-icon">{ROLE_ICON[r]}</div>
                  <div className="strong small">{ROLE_LABEL[r]}</div>
                  <div className="faint tiny">{['grants LG licence', 'issues Manufacturing License', 'issues Trade License', 'issues Trade License', 'sells to customers'][i]}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="3 · Taking part as a company" subtitle="One-time setup, then follow the checklist in your dashboard.">
          <ol className="guide-list">
            <li><b>Install MetaMask</b> from <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">metamask.io</a> and create a wallet.</li>
            <li>
              <b>Click “🦊 Participant sign-in”</b> (top right). The site adds the network for you; if you prefer to add it by hand:
              <div className="kv" style={{ marginTop: 8 }}>
                <div className="kv-item"><div className="kv-k">Network</div><div className="kv-v">{IS_BESU ? 'besu' : CHAIN_NAME}</div></div>
                <div className="kv-item"><div className="kv-k">RPC URL</div><div className="kv-v mono small">{RPC_URL} <CopyButton text={RPC_URL} /></div></div>
                <div className="kv-item"><div className="kv-k">Chain ID</div><div className="kv-v">{CHAIN_ID}</div></div>
                <div className="kv-item"><div className="kv-k">Symbol</div><div className="kv-v">TRUST</div></div>
              </div>
            </li>
            <li><b>Register your company</b>: choose a role, a unique company name and (optionally) a notification email. This creates your DID on-chain.</li>
            <li><b>Follow the checklist</b>: right after registering, a pop-up explains your next steps. The same list stays in the “Getting started” bar at the top of your dashboard and ticks itself off as you go.</li>
          </ol>
        </Card>

        <Card title="4 · Step by step, per role" subtitle="Exactly what to click and what the blockchain does at each step.">
          <Tabs value={role} onChange={setRole} tabs={Object.keys(ROLE_GUIDE).map(r => ({ id: r, label: ROLE_LABEL[r], icon: ROLE_ICON[r] }))} />
          <p className="muted" style={{ marginBottom: 14 }}>{g.intro}</p>
          <ol className="onb-list">
            {g.steps.map((s, i) => (
              <li key={s.id} className="onb-item">
                <span className="onb-num">{i + 1}</span>
                <div className="grow">
                  <div className="onb-title">{s.title}{s.optional && <span className="faint small"> · optional</span>}</div>
                  <div className="step-body">
                    <div><b>What you do:</b> {s.do}</div>
                    <div className="faint"><b>What happens on-chain:</b> {s.happens}</div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="5 · Life of a product" subtitle="Every event below is recorded on-chain and shown on the product's public page.">
          <div className="lifecycle">
            {LIFECYCLE.map(([icon, t, txt]) => (
              <div key={t} className="lc-item"><div className="lc-icon">{icon}</div><div><div className="strong">{t}</div><div className="muted small">{txt}</div></div></div>
            ))}
          </div>
        </Card>

        <Card title="6 · Questions">
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q}><summary>{q}</summary><p className="muted">{a}</p></details>
            ))}
          </div>
        </Card>

        <div className="row" style={{ justifyContent: 'center' }}>
          <Button variant="secondary" onClick={() => go('/products')}>Browse all products</Button>
          <Button onClick={() => go('/app')}>🦊 Participant sign-in</Button>
        </div>
      </div>
    </div>
  )
}
