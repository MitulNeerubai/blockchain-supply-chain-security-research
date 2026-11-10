import { useState } from 'react'
import { loadProducts, reader } from '../lib/chain'
import { useDirectory, useLoad, useSession, useTx } from '../lib/app'
import { fmtDate, sameAddr, short } from '../lib/format'
import { Button, Empty, Loading, Alert } from './ui'
import { HistoryModal, QRModal, StatusPill, locationOf } from './Products'

/** One product row: title/meta on the left, actions on the right, optional footer. */
export function ProductItem({ p, actions, foot }) {
  const s = useSession()
  const d = useDirectory()
  return (
    <div className="item">
      <div className="item-main">
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <span className="item-title">{p.name}</span>
            <span className="pid">#{p.id}</span>
            <StatusPill status={p.status} />
          </div>
          <div className="item-meta">
            <span>📍 {locationOf(p, s.address, d.name)}</span>
            {!sameAddr(p.manufacturer, s.address) && <span>🏭 {d.name(p.manufacturer)}</span>}
            <span>Qty {p.quantity}</span>
            {p.batchNumber && <span>Batch {p.batchNumber}</span>}
            <span>Created {fmtDate(p.createdAt)}</span>
          </div>
        </div>
        <div className="item-actions">{actions}</div>
      </div>
      {foot && <div className="item-foot">{foot}</div>}
    </div>
  )
}

/** Ship-to row: dropdown of active partners you licensed. */
export function ShipForm({ product, partners, partnerLabel, onShipped }) {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const [to, setTo] = useState('')
  const key = 'ship:' + product.id
  if (!partners.length) {
    return <span className="small muted">No active {partnerLabel.toLowerCase()}s licensed by you yet — license one in the {partnerLabel}s tab to ship.</span>
  }
  return (
    <div className="ship-row">
      <select className="select" value={to} onChange={e => setTo(e.target.value)}>
        <option value="">Ship to {partnerLabel.toLowerCase()}…</option>
        {partners.map(c => <option key={c.holder} value={c.holder}>{d.name(c.holder)} — {short(c.holder)}</option>)}
      </select>
      <Button variant="success" disabled={!to || !!busy} loading={busy === key}
        onClick={() => run(key, () => s.write.pt.shipTo(product.id, to), { success: `Shipped “${product.name}” to ${d.name(to)}.`, onDone: onShipped })}>
        Ship →
      </Button>
    </div>
  )
}

/** QR + History buttons and their modals. */
export function useProductModals() {
  const [qr, setQr] = useState(null)
  const [hist, setHist] = useState(null)
  const buttons = p => (
    <>
      <Button variant="ghost" size="sm" onClick={() => setHist(p.id)}>History</Button>
      <Button variant="secondary" size="sm" onClick={() => setQr(p)}>QR</Button>
    </>
  )
  const modals = (
    <>
      {qr && <QRModal product={qr} onClose={() => setQr(null)} />}
      {hist && <HistoryModal id={hist} onClose={() => setHist(null)} />}
    </>
  )
  return { buttons, modals }
}

/** Products currently shipped to me and awaiting my confirmation. */
export function useIncoming() {
  const s = useSession()
  return useLoad(async () => {
    const ids = await reader().pt.getShipmentsTo(s.address)
    return (await loadProducts(ids)).filter(p => p.status === 1 && sameAddr(p.pending, s.address))
  }, [s.address])
}

export function IncomingList({ incoming, onAccepted, emptyText }) {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const { buttons, modals } = useProductModals()
  if (incoming.loading) return <Loading />
  if (incoming.error) return <Alert type="error">{incoming.error}</Alert>
  if (!incoming.data.length) return <Empty icon="📬" title="No incoming shipments">{emptyText}</Empty>
  return (
    <>
      {incoming.data.map(p => (
        <ProductItem key={p.id} p={p} actions={<>
          {buttons(p)}
          <Button variant="success" size="sm" disabled={!!busy} loading={busy === 'accept:' + p.id}
            onClick={() => run('accept:' + p.id, () => s.write.pt.confirmReceipt(p.id), { success: `Received “${p.name}” from ${d.name(p.holder)}.`, onDone: onAccepted })}>
            ✓ Accept shipment
          </Button>
        </>} />
      ))}
      {modals}
    </>
  )
}

export function FilterChips({ value, onChange, options }) {
  return (
    <div className="chips">
      {options.map(([k, label, n]) => (
        <button key={k} className={`chip${value === k ? ' active' : ''}`} onClick={() => onChange(k)}>
          {label}{n != null ? ` (${n})` : ''}
        </button>
      ))}
    </div>
  )
}
