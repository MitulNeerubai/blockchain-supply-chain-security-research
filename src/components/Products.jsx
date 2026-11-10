import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { loadAudit, loadProduct, reader } from '../lib/chain'
import { go, useDirectory, useSession, useTx } from '../lib/app'
import { KIND, STATUS, STATUS_PILL, errMsg, fmtDate, fmtDateTime, sameAddr } from '../lib/format'
import { Alert, Button, Card, CompanyLink, Entity, Loading, Modal, CopyButton } from './ui'

export const verifyUrl = id => `${window.location.origin}${window.location.pathname}#/product/${id}`

export function StatusPill({ status }) {
  return <span className={`badge pill-dot ${STATUS_PILL[status]}`}>{STATUS[status]}</span>
}

/** Where a product is, in words, from the viewer's point of view. */
export function locationOf(p, me, name) {
  if (p.status === 3) return 'Deleted by manufacturer'
  if (p.status === 1) {
    const verb = p.last?.kind === KIND.RETURN ? 'Returning' : 'In transit'
    return sameAddr(p.holder, me) ? `${verb} to ${name(p.pending)}` : `${verb} ${name(p.holder)} → ${name(p.pending)}`
  }
  if (sameAddr(p.holder, me)) return 'With you'
  return p.status === 2 ? `Delivered to ${name(p.holder)}` : `At ${name(p.holder)}`
}

/** The last event's note (return reason, call-back reason…) as a small callout. */
export function LastNote({ p }) {
  const l = p.last
  if (!l || !l.note || l.note === 'Cancelled by sender') return null
  const lapse = /licence|reverted|called back/i.test(l.note)
  const icon = l.kind === KIND.RETURN ? '↩' : lapse ? '⚠' : 'ℹ'
  const label = l.kind === KIND.RETURN ? 'Return reason' : l.cancelled ? 'Shipment stopped' : l.kind === KIND.RECLAIM ? 'Called back' : 'Note'
  return <div className={`note ${lapse ? 'warn' : ''}`}><span>{icon}</span><span><b>{label}:</b> {l.note}</span></div>
}

const KIND_TITLE = {
  [KIND.SHIP]: (h, role) => h.cancelled ? 'Shipment stopped' : h.confirmed ? `Received by ${role || 'recipient'}` : 'Shipped — awaiting confirmation',
  [KIND.RETURN]: h => h.cancelled ? 'Return stopped' : h.confirmed ? 'Return received' : 'Returned — awaiting confirmation',
  [KIND.RECALL]: () => 'Recalled upstream',
  [KIND.RECLAIM]: () => 'Called back (licence lapsed)',
}

export function Timeline({ product }) {
  const d = useDirectory()
  const items = [{ key: 'c', dot: '', title: 'Created', from: product.manufacturer, at: product.createdAt }]
  product.history.forEach((h, i) => {
    items.push({
      key: i,
      dot: h.cancelled ? 'x' : h.kind === KIND.RECLAIM || h.kind === KIND.RECALL ? 'warn' : h.kind === KIND.RETURN ? (h.confirmed ? 'ret' : 'wait') : h.confirmed ? 'ok' : 'wait',
      title: KIND_TITLE[h.kind](h, d.get(h.to)?.role),
      from: h.from, to: h.to, note: h.note && h.note !== 'Cancelled by sender' ? h.note : h.cancelled ? 'Cancelled by sender' : '',
      at: h.timestamp,
    })
  })
  if (product.status === 3) items.push({ key: 'del', dot: 'x', title: 'Deleted by manufacturer', from: product.manufacturer, at: null })
  return (
    <div className="timeline">
      {items.map(it => (
        <div className="tl" key={it.key}>
          <span className={`tl-dot ${it.dot}`} />
          <div className="tl-title">{it.title}</div>
          <div className="tl-meta">
            {it.to
              ? <><CompanyLink address={it.from}>{d.name(it.from)}</CompanyLink> → <CompanyLink address={it.to}>{d.name(it.to)}</CompanyLink></>
              : <>by <CompanyLink address={it.from}>{d.name(it.from)}</CompanyLink></>}
            {it.at ? <> · {fmtDateTime(it.at)}</> : null}
          </div>
          {it.note && <div className="tl-note">“{it.note}”</div>}
        </div>
      ))}
    </div>
  )
}

export function QRModal({ product, onClose }) {
  const [src, setSrc] = useState('')
  const url = verifyUrl(product.id)
  useEffect(() => {
    QRCode.toDataURL(url, { width: 440, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }).then(setSrc).catch(() => setSrc(''))
  }, [url])
  return (
    <Modal title="Product QR code" onClose={onClose}>
      <div className="stack center">
        <div>
          <div className="strong">{product.name}</div>
          <div className="pid">Product #{product.id}</div>
        </div>
        {src ? <img className="qr-img" src={src} alt={`QR code for product ${product.id}`} /> : <Loading />}
        <p className="muted small">Anyone can scan this to verify the full chain of custody — no wallet needed.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <div className="copy-box grow">{url}</div><CopyButton text={url} label="Copy link" />
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          {src && <a className="btn btn-secondary" href={src} download={`product-${product.id}-qr.png`}>⬇ Download PNG</a>}
          <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">Open public page ↗</a>
        </div>
      </div>
    </Modal>
  )
}

export function HistoryModal({ id, onClose }) {
  const [p, setP] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { loadProduct(id).then(setP).catch(e => setErr(errMsg(e))) }, [id])
  return (
    <Modal title={`Product #${id} history`} onClose={onClose} width={560}>
      {err ? <Alert type="error">{err}</Alert> : !p ? <Loading /> : (
        <div className="stack">
          <div className="row-between"><b>{p.name}</b><StatusPill status={p.status} /></div>
          <Timeline product={p} />
          <a className="small" href={`#/product/${p.id}`} onClick={onClose}>Open the public product page →</a>
        </div>
      )}
    </Modal>
  )
}

export function AuditVerdict({ audit, compact }) {
  const d = useDirectory()
  if (!audit) return null
  if (!audit.verified) return <Alert type="error" title="Chain not verified">{audit.failReason}</Alert>
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Alert type="success" title="Chain verified">Manufacturer → Distributor → Retailer confirmed on-chain, and every handoff was licensed at the time it happened.</Alert>
      {audit.currentlyValid
        ? !compact && <Alert type="info">All three licences are still active today.</Alert>
        : <Alert type="warning" title="Licence status changed since delivery">{audit.currentNote}. The past handoffs remain valid, but this party can no longer trade.</Alert>}
      <div className="chain">
        {[['Manufacturer', audit.manufacturer, audit.manufacturedAt, 'Created'], ['Distributor', audit.distributor, audit.shippedToDistributor, 'Shipped'], ['Retailer', audit.retailer, audit.shippedToRetailer, 'Shipped']].map(([role, addr, at, verb]) => (
          <div className="chain-node" key={role}>
            <div className="chain-node-role" style={{ color: `var(--role-${role})` }}>{role}</div>
            <div style={{ marginTop: 6 }}><Entity address={addr} name={d.name(addr)} role={role} size={28} /></div>
            <div className="faint small" style={{ marginTop: 6 }}>{verb} {fmtDate(at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Look up any product by ID; shows details, history, audit and (if allowed) call-back. */
export function ProductLookup() {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const [id, setId] = useState('')
  const [state, setState] = useState({ loading: false, err: '', product: null, audit: null, reclaim: null })
  const [qr, setQr] = useState(false)

  async function search(e) {
    e?.preventDefault?.()
    const n = id.trim()
    if (!/^\d+$/.test(n) || n === '0') return setState(st => ({ ...st, err: 'Enter a product number, e.g. 1.' }))
    setState({ loading: true, err: '', product: null, audit: null, reclaim: null })
    try {
      const [product, audit, rc] = await Promise.all([loadProduct(n), loadAudit(n), reader().pt.reclaimable(n)])
      setState({ loading: false, err: '', product, audit, reclaim: { ok: rc[0], reason: rc[1] } })
    } catch (e2) {
      setState({ loading: false, err: /not found/i.test(errMsg(e2)) ? `No product #${n} exists.` : errMsg(e2), product: null, audit: null, reclaim: null })
    }
  }

  const reclaim = () => run('reclaim', () => s.write.pt.reclaimProduct(state.product.id), { success: 'Product called back.', onDone: search })

  const p = state.product
  return (
    <div className="stack">
      <Card title="Product lookup" subtitle="Search any product to see where it is, its full history and whether its chain verifies.">
        <form className="row" onSubmit={search}>
          <input className="input grow" style={{ maxWidth: 260 }} inputMode="numeric" placeholder="Product number, e.g. 1" value={id} onChange={e => setId(e.target.value)} />
          <Button type="submit" loading={state.loading}>Search</Button>
          <Button type="button" variant="ghost" onClick={() => go('/products')}>Browse all products →</Button>
        </form>
        {state.err && <div style={{ marginTop: 12 }}><Alert type="error">{state.err}</Alert></div>}
      </Card>

      {p && (
        <div className="grid grid-2">
          <Card title={p.name} subtitle={`Product #${p.id}`} actions={<><StatusPill status={p.status} /><Button variant="secondary" size="sm" onClick={() => setQr(true)}>QR</Button></>}>
            <div className="stack">
              <div className="kv">
                <div className="kv-item"><div className="kv-k">Manufacturer</div><div className="kv-v"><CompanyLink address={p.manufacturer}>{d.name(p.manufacturer)}</CompanyLink></div></div>
                <div className="kv-item"><div className="kv-k">Location</div><div className="kv-v">{locationOf(p, s?.address, d.name)}</div></div>
                <div className="kv-item"><div className="kv-k">Quantity</div><div className="kv-v">{p.quantity}</div></div>
                {p.batchNumber && <div className="kv-item"><div className="kv-k">Batch</div><div className="kv-v">{p.batchNumber}</div></div>}
              </div>
              {p.description && <p className="muted">{p.description}</p>}
              {state.reclaim?.ok && (
                <Alert type="warning" title="Licence lapsed — product can be called back"
                  action={s && <Button size="sm" variant="secondary" loading={busy === 'reclaim'} onClick={reclaim}>Call back</Button>}>
                  {state.reclaim.reason}
                </Alert>
              )}
              <div className="divider" />
              <Timeline product={p} />
            </div>
          </Card>
          <Card title="Chain-of-custody audit" subtitle="Run by the TraceabilityAudit contract">
            <AuditVerdict audit={state.audit} />
          </Card>
        </div>
      )}
      {qr && p && <QRModal product={p} onClose={() => setQr(false)} />}
    </div>
  )
}
