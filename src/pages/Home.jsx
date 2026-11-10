import { useState } from 'react'
import { CHAIN_NAME, loadAuditLog } from '../lib/chain'
import { go, useDirectory, useLoad, useNetwork } from '../lib/app'
import { fmtDateTime } from '../lib/format'
import { Alert, Button, Card, CompanyLink, Empty, Loading, Stat } from '../components/ui'
import { TrustTree } from '../components/Network'
import { ProductTable, useAllProducts } from './AllProducts'

const ACTION_LABEL = {
  DID_REGISTERED: 'registered', DID_DEACTIVATED: 'deactivated its DID', CREDENTIAL_ISSUED: 'issued a licence', CREDENTIAL_REVOKED: 'revoked a licence',
  PRODUCT_CREATED: 'created a product', PRODUCT_DELETED: 'deleted a product', PRODUCT_SHIPPED: 'shipped a product', PRODUCT_RETURNED: 'returned a product',
  PRODUCT_RECEIVED: 'accepted a product', SHIPMENT_CANCELLED: 'cancelled a shipment', SHIPMENT_REVERTED: 'reverted a shipment (licence lapsed)',
  PRODUCT_FORCE_RECALLED: 'recalled a product', PRODUCT_RECLAIMED: 'called back a product (licence lapsed)',
}

export default function Home() {
  const d = useDirectory()
  const net = useNetwork()
  const products = useAllProducts()
  const log = useLoad(() => loadAuditLog(10), [])
  const [id, setId] = useState('')
  const list = products.data || []
  const companies = [...d.dir.values()]

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-text">
          <div className="hero-kicker">Public explorer · {CHAIN_NAME}</div>
          <h1 className="hero-title">Trace every product from factory to shelf</h1>
          <p className="hero-sub">Every product, company and licence below is read live from the blockchain. Browse, search and verify — <b>no wallet, no sign-in</b>.</p>
          <div className="row" style={{ marginTop: 18 }}>
            <Button size="lg" onClick={() => go('/products')}>📦 Browse all products</Button>
            <Button size="lg" variant="secondary" onClick={() => go('/guide')}>📘 How it works</Button>
          </div>
        </div>
        <form className="hero-verify card" onSubmit={e => { e.preventDefault(); if (id.trim()) go('/product/' + id.trim()) }}>
          <div className="strong">Verify a product</div>
          <div className="muted small">Enter the number from the label or QR code.</div>
          <div className="row" style={{ marginTop: 10 }}>
            <input className="input grow" inputMode="numeric" placeholder="Product #, e.g. 1" value={id} onChange={e => setId(e.target.value)} />
            <Button type="submit">Verify</Button>
          </div>
          <div className="divider" style={{ margin: '14px 0' }} />
          <div className="strong">Are you a participant?</div>
          <div className="muted small">Manufacturers, distributors, retailers and governments sign in with MetaMask to act.</div>
          <Button variant="secondary" block style={{ marginTop: 10 }} onClick={() => go('/app')}>🦊 Participant sign-in</Button>
        </form>
      </section>

      <div className="grid grid-stats" style={{ margin: '20px 0' }}>
        <Stat label="Products" value={products.data ? list.filter(p => p.status !== 3).length : '…'} />
        <Stat label="In transit" value={products.data ? list.filter(p => p.status === 1).length : '…'} />
        <Stat label="Delivered to stores" value={products.data ? list.filter(p => p.status === 2).length : '…'} />
        <Stat label="Companies" value={d.loading ? '…' : companies.length} hint={`${companies.filter(c => net.statusOf(c.address).state === 'active').length} active`} />
        <Stat label="Active licences" value={net.ready ? net.creds.filter(c => c.active).length + Object.values(net.lg).filter(x => x.authorized).length : '…'} />
      </div>

      <Card title="How to navigate this site" subtitle="Start anywhere — every page is public.">
        <div className="nav-steps">
          {[
            ['1', '📦', 'Products', 'See every product, where it is now and its status.', '/products'],
            ['2', '🔍', 'Open a product', 'Click any product for its full history, the parties involved and the verification result.', '/products'],
            ['3', '🏢', 'Companies', 'Every account with its live licence status and who licensed whom.', '/companies'],
            ['4', '📘', 'How it works', 'Step-by-step guide per role, product lifecycle and FAQ.', '/guide'],
          ].map(([n, icon, t, txt, path]) => (
            <a key={n} className="nav-step" href={'#' + path}>
              <span className="onb-num">{n}</span>
              <span><span className="strong">{icon} {t}</span><span className="muted small" style={{ display: 'block' }}>{txt}</span></span>
            </a>
          ))}
        </div>
      </Card>

      <div className="grid grid-home" style={{ marginTop: 16 }}>
        <Card title="Latest products" bodyClass="tight" actions={<Button variant="ghost" size="sm" onClick={() => go('/products')}>View all →</Button>}>
          {products.loading ? <Loading /> : products.error ? <div className="card-body"><Alert type="error">{products.error}</Alert></div>
            : !list.length ? <Empty icon="📦" title="No products yet">They appear here as soon as a licensed manufacturer creates one.</Empty>
            : <ProductTable rows={list.slice(0, 8)} />}
        </Card>
        <Card title="Recent on-chain activity" bodyClass="tight">
          {log.loading ? <Loading /> : log.error ? <div className="card-body"><Alert type="error">{log.error}</Alert></div>
            : !log.data?.length ? <Empty icon="📜" title="No activity yet" />
            : (
              <ul className="activity">
                {log.data.map(e => {
                  const pid = /productId=(\d+)/.exec(e.details)?.[1]
                  return (
                    <li key={e.index}>
                      <span><CompanyLink address={e.actor}>{d.name(e.actor)}</CompanyLink> {ACTION_LABEL[e.action] || e.action.toLowerCase()}{pid && <> <a href={`#/product/${pid}`}>#{pid}</a></>}</span>
                      <span className="faint small nowrap">{fmtDateTime(e.timestamp)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
        </Card>
      </div>

      <Card title="Trust map" subtitle="Who licensed whom, with live status. Click any company for its profile." className="mt">
        <TrustTree />
      </Card>
    </div>
  )
}
