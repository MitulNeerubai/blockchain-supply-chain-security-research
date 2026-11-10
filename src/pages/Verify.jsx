import { useEffect, useState } from 'react'
import { EXPLORER, CHAIN_NAME, loadAudit, loadProduct, reader } from '../lib/chain'
import { useDirectory } from '../lib/app'
import { errMsg, fmtDate } from '../lib/format'
import { Alert, Button, Card, Entity, Loading, Pill } from '../components/ui'
import { StatusPill, Timeline } from '../components/Products'

/** Public page reached by scanning a product QR code — no wallet needed. */
export default function Verify({ productId }) {
  const d = useDirectory()
  const [id, setId] = useState(productId || '')
  const [state, setState] = useState({ loading: !!productId, err: '', product: null, audit: null, creds: {} })

  async function run(n) {
    if (!/^\d+$/.test(n) || n === '0') { setState(s => ({ ...s, err: 'Enter a product number.' })); return }
    setState({ loading: true, err: '', product: null, audit: null, creds: {} })
    try {
      const [product, audit] = await Promise.all([loadProduct(n), loadAudit(n)])
      const { cred } = reader()
      const parties = [...new Set([product.manufacturer, ...product.history.map(h => h.to)])]
      const valid = await Promise.all(parties.map(a => cred.isCredentialValid(a)))
      setState({ loading: false, err: '', product, audit, creds: Object.fromEntries(parties.map((a, i) => [a.toLowerCase(), valid[i]])) })
      const url = new URL(window.location.href); url.searchParams.set('verify', n); window.history.replaceState({}, '', url)
    } catch (e) {
      setState({ loading: false, err: /not found/i.test(errMsg(e)) ? `No product #${n} exists on ${CHAIN_NAME}.` : errMsg(e), product: null, audit: null, creds: {} })
    }
  }
  useEffect(() => { if (productId) run(productId) }, [productId])

  const { product: p, audit: a } = state
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <Card>
        <form className="row" onSubmit={e => { e.preventDefault(); run(id.trim()) }}>
          <div className="grow"><b>Verify a product</b><div className="muted small">Check its chain of custody on {CHAIN_NAME}.</div></div>
          <input className="input" style={{ width: 160 }} inputMode="numeric" placeholder="Product #" value={id} onChange={e => setId(e.target.value)} />
          <Button type="submit" loading={state.loading}>Verify</Button>
        </form>
      </Card>

      <div className="stack" style={{ marginTop: 16 }}>
        {state.loading && <div className="card"><Loading>Verifying on the blockchain…</Loading></div>}
        {state.err && <Alert type="error">{state.err}</Alert>}

        {p && a && (
          <>
            <div className={`card verdict ${a.verified ? 'ok' : 'bad'}`}>
              <div className="verdict-icon">{a.verified ? '✓' : '✕'}</div>
              <div className="verdict-title">{a.verified ? 'Authentic — chain verified' : 'Not verified'}</div>
              <p className="muted" style={{ marginTop: 6 }}>
                {a.verified ? 'This product moved Manufacturer → Distributor → Retailer, and every party holds an active licence.' : a.failReason}
              </p>
            </div>

            <Card title={p.name} subtitle={`Product #${p.id}`} actions={<StatusPill status={p.status} />}>
              <div className="stack">
                <div className="kv">
                  <div className="kv-item"><div className="kv-k">Manufacturer</div><div className="kv-v">{d.name(p.manufacturer)}</div></div>
                  <div className="kv-item"><div className="kv-k">Created</div><div className="kv-v">{fmtDate(p.createdAt)}</div></div>
                  <div className="kv-item"><div className="kv-k">Quantity</div><div className="kv-v">{p.quantity}</div></div>
                  {p.batchNumber && <div className="kv-item"><div className="kv-k">Batch</div><div className="kv-v">{p.batchNumber}</div></div>}
                </div>
                {p.description && <p className="muted">{p.description}</p>}
              </div>
            </Card>

            <Card title="Parties" subtitle="Each party's licence status right now">
              <div className="stack" style={{ gap: 10 }}>
                {Object.keys(state.creds).map(addr => {
                  const who = d.get(addr)
                  return (
                    <div key={addr} className="row-between">
                      <Entity address={who?.address || addr} name={who?.company} role={who?.role} sub={who?.role} />
                      <Pill tone={state.creds[addr] ? 'green' : 'red'} dot>{state.creds[addr] ? 'Licence active' : 'Licence not valid'}</Pill>
                    </div>
                  )
                })}
              </div>
            </Card>

            <Card title="Chain of custody"><Timeline product={p} /></Card>
          </>
        )}
        <p className="footer-note">
          Data read directly from the {CHAIN_NAME} blockchain{EXPLORER && <> · <a href={EXPLORER} target="_blank" rel="noreferrer">Block explorer ↗</a></>} · <a href={window.location.pathname}>Sign in</a>
        </p>
      </div>
    </div>
  )
}
