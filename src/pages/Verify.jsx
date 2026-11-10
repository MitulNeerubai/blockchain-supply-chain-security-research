import { useEffect, useState } from 'react'
import { EXPLORER, CHAIN_NAME, loadAudit, loadProduct, reader } from '../lib/chain'
import { go, useDirectory, useNetwork } from '../lib/app'
import { KIND, errMsg, fmtDate } from '../lib/format'
import { Alert, Button, Card, CompanyLink, CredPill, Entity, Loading, Pill } from '../components/ui'
import { QRModal, StatusPill, Timeline, locationOf } from '../components/Products'

/** Public product page (#/product/<id>, #/verify, or a scanned QR) — no wallet needed. */
export default function Verify({ productId }) {
  const d = useDirectory()
  const net = useNetwork()
  const [id, setId] = useState(productId || '')
  const [state, setState] = useState({ loading: !!productId, err: '', product: null, audit: null, reclaim: null })
  const [qr, setQr] = useState(false)

  async function run(n) {
    if (!/^\d+$/.test(n) || n === '0') { setState(s => ({ ...s, err: 'Enter a product number.' })); return }
    setState({ loading: true, err: '', product: null, audit: null, reclaim: null })
    try {
      const [product, audit, rc] = await Promise.all([loadProduct(n), loadAudit(n), reader().pt.reclaimable(n)])
      setState({ loading: false, err: '', product, audit, reclaim: { ok: rc[0], reason: rc[1] } })
    } catch (e) {
      setState({ loading: false, err: /not found/i.test(errMsg(e)) ? `No product #${n} exists on ${CHAIN_NAME}.` : errMsg(e), product: null, audit: null, reclaim: null })
    }
  }
  useEffect(() => { setId(productId || ''); if (productId) run(productId) }, [productId])

  const { product: p, audit: a } = state

  // Each party with the licence that matters for THIS product (relationship-specific)
  const parties = []
  if (p) {
    parties.push({ addr: p.manufacturer, role: 'Manufacturer', lic: null })
    const seen = new Set([p.manufacturer.toLowerCase()])
    for (const h of p.history) {
      if (h.kind !== KIND.SHIP || seen.has(h.to.toLowerCase())) continue
      seen.add(h.to.toLowerCase())
      parties.push({ addr: h.to, role: d.get(h.to)?.role, lic: net.pair(h.from, h.to), from: h.from })
    }
  }

  return (
    <div className="page">
      <Card>
        <form className="row" onSubmit={e => { e.preventDefault(); go('/product/' + id.trim()) }}>
          <div className="grow"><b>Verify a product</b><div className="muted small">Check its chain of custody on {CHAIN_NAME}. No wallet needed.</div></div>
          <input className="input" style={{ width: 160 }} inputMode="numeric" placeholder="Product #" value={id} onChange={e => setId(e.target.value)} />
          <Button type="submit" loading={state.loading}>Verify</Button>
        </form>
      </Card>

      <div className="stack" style={{ marginTop: 16 }}>
        {!productId && !state.loading && (
          <Alert type="info">Type a product number, scan a product's QR code, or <a href="#/products">browse all products</a>.</Alert>
        )}
        {state.loading && <div className="card"><Loading>Verifying on the blockchain…</Loading></div>}
        {state.err && <Alert type="error">{state.err}</Alert>}

        {p && a && (
          <>
            <div className={`card verdict ${a.verified ? (a.currentlyValid ? 'ok' : 'warn') : p.status === 0 || p.status === 1 ? 'warn' : 'bad'}`}>
              <div className="verdict-icon">{a.verified ? '✓' : p.status === 1 || p.status === 0 ? '…' : '✕'}</div>
              <div className="verdict-title">
                {a.verified ? 'Authentic — chain verified' : p.status === 3 ? 'Deleted product' : p.status === 2 ? 'Not verified' : 'Not at a retailer yet'}
              </div>
              <p className="muted" style={{ marginTop: 6 }}>
                {a.verified
                  ? 'This product moved Manufacturer → Distributor → Retailer, and every handoff was licensed at the time it happened.'
                  : a.failReason}
              </p>
              {a.verified && !a.currentlyValid && <div style={{ marginTop: 12, textAlign: 'left' }}><Alert type="warning" title="A licence has changed since delivery">{a.currentNote}.</Alert></div>}
            </div>

            <Card title={p.name} subtitle={`Product #${p.id}`} actions={<><StatusPill status={p.status} />{p.status !== 3 && <Button variant="secondary" size="sm" onClick={() => setQr(true)}>QR</Button>}</>}>
              <div className="stack">
                <div className="kv">
                  <div className="kv-item"><div className="kv-k">Manufacturer</div><div className="kv-v"><CompanyLink address={p.manufacturer}>{d.name(p.manufacturer)}</CompanyLink></div></div>
                  <div className="kv-item"><div className="kv-k">Where it is now</div><div className="kv-v">{locationOf(p, null, d.name)}</div></div>
                  <div className="kv-item"><div className="kv-k">Created</div><div className="kv-v">{fmtDate(p.createdAt)}</div></div>
                  <div className="kv-item"><div className="kv-k">Quantity</div><div className="kv-v">{p.quantity}</div></div>
                  {p.batchNumber && <div className="kv-item"><div className="kv-k">Batch</div><div className="kv-v">{p.batchNumber}</div></div>}
                </div>
                {p.description && <p className="muted">{p.description}</p>}
                {state.reclaim?.ok && (
                  <Alert type="warning" title={p.status === 1 ? 'This shipment cannot be delivered' : 'This product is due to be called back'}>
                    {state.reclaim.reason.replace(/^[^:]*:\s*/, '').replace(/^./, c => c.toUpperCase())}. {p.status === 1 ? 'It returns to the sender automatically, or the sender can call it back.' : 'The upstream company can call it back.'}
                  </Alert>
                )}
              </div>
            </Card>

            <Card title="Parties" subtitle="Each party and the licence it holds for this product, right now">
              <div className="stack" style={{ gap: 10 }}>
                {parties.map(x => (
                  <div key={x.addr} className="row-between">
                    <Entity address={x.addr} name={d.get(x.addr)?.company} role={x.role} sub={x.from ? `${x.role} · licensed by ${d.name(x.from)}` : x.role} />
                    {x.lic ? <CredPill status={x.lic.status} />
                      : x.from ? <Pill tone="gray" dot>No licence</Pill>
                      : <Pill tone={net.statusOf(x.addr).state === 'active' ? 'green' : 'red'} dot>{net.statusOf(x.addr).label}</Pill>}
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Chain of custody" subtitle="Every shipment, return, recall and call-back — with the reason when there is one"><Timeline product={p} /></Card>
          </>
        )}
        <p className="footer-note">
          Data read directly from the {CHAIN_NAME} blockchain{EXPLORER && <> · <a href={EXPLORER} target="_blank" rel="noreferrer">Block explorer ↗</a></>} · <a href="#/products">All products</a>
        </p>
      </div>
      {qr && p && <QRModal product={p} onClose={() => setQr(false)} />}
    </div>
  )
}
