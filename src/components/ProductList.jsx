import { useState } from 'react'
import { loadProducts, loadReclaimable, reader } from '../lib/chain'
import { useDirectory, useLoad, useNetwork, useSession, useTx } from '../lib/app'
import { KIND, fmtDate, sameAddr, short } from '../lib/format'
import { Alert, Button, CredPill, Empty, Entity, Loading, Modal, Pill } from './ui'
import { HistoryModal, LastNote, QRModal, StatusPill, locationOf } from './Products'

/** One product row: title/meta on the left, actions on the right, optional footer. */
export function ProductItem({ p, actions, foot, warn }) {
  const s = useSession()
  const d = useDirectory()
  return (
    <div className={`item${warn ? ' item-warn' : ''}`}>
      <div className="item-main">
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <span className="item-title">{p.name}</span>
            <span className="pid">#{p.id}</span>
            <StatusPill status={p.status} />
            {p.last?.kind === KIND.RETURN && p.status === 1 && <Pill tone="amber">Return</Pill>}
          </div>
          <div className="item-meta">
            <span>📍 {locationOf(p, s?.address, d.name)}</span>
            {!sameAddr(p.manufacturer, s?.address) && <span>🏭 {d.name(p.manufacturer)}</span>}
            <span>Qty {p.quantity}</span>
            {p.batchNumber && <span>Batch {p.batchNumber}</span>}
            <span>Created {fmtDate(p.createdAt)}</span>
          </div>
          <LastNote p={p} />
          {warn && <div className="note warn"><span>⚠</span><span>{warn}</span></div>}
        </div>
        <div className="item-actions">{actions}</div>
      </div>
      {foot && <div className="item-foot">{foot}</div>}
    </div>
  )
}

/** A bordered box per company (e.g. one per Manufacturer on the Distributor page). */
export function GroupBox({ address, title, extra, count, children }) {
  const d = useDirectory()
  const who = d.get(address)
  return (
    <section className="group">
      <div className="group-head">
        {address ? <Entity address={address} name={who?.company} role={who?.role} size={30} sub={title} /> : <b>{title}</b>}
        <div className="row" style={{ gap: 8 }}>{extra}{count != null && <span className="tab-count">{count}</span>}</div>
      </div>
      <div className="group-body">{children}</div>
    </section>
  )
}

/** [[key, items[]], …] preserving first-seen order. */
export function groupBy(list, keyFn) {
  const m = new Map()
  for (const x of list) {
    const k = (keyFn(x) || '').toLowerCase()
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return [...m.entries()]
}

/** Pill showing the licence between issuer and holder (e.g. "your licence from Acme"). */
export function PairPill({ issuer, holder }) {
  const net = useNetwork()
  const c = net.pair(issuer, holder)
  if (!net.ready) return null
  if (!c) return <Pill tone="gray" dot>No licence</Pill>
  return <CredPill status={c.status} />
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
      {p.status !== 3 && <Button variant="secondary" size="sm" onClick={() => setQr(p)}>QR</Button>}
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

// ── Return to sender ────────────────────────────────────────────────────────
const REASONS = ['Damaged in transit', 'Wrong product or batch', 'Quality issue', 'Excess stock', 'Ordered by mistake']

/** "↩ Return" button + modal. Distributor → Manufacturer, Retailer → Distributor. */
export function useReturn(onDone) {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const [target, setTarget] = useState(null) // { p, to }
  const [reason, setReason] = useState('')

  async function openFor(p) {
    const shipper = await reader().pt.shipperTo(p.id, s.address).catch(() => null)
    setReason('')
    setTarget({ p, to: shipper && !/^0x0+$/.test(shipper) ? shipper : p.manufacturer })
  }
  const button = p => (
    <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => openFor(p)} title="Send this product back to the company that shipped it to you">↩ Return</Button>
  )
  const clean = reason.trim()
  const modal = target && (
    <Modal title="Return to sender" onClose={() => setTarget(null)} width={500}>
      <div className="stack">
        <p className="muted">
          Send <b>{target.p.name}</b> <span className="pid">#{target.p.id}</span> back to <b>{d.name(target.to)}</b>.
          It shows up in their <i>Incoming</i> list; custody moves back to them once they accept it. You can cancel the return until then.
        </p>
        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>Reason (required — stored on-chain and shown in the product history)</div>
          <div className="chips" style={{ marginBottom: 8 }}>
            {REASONS.map(r => <button key={r} type="button" className={`chip${reason === r ? ' active' : ''}`} onClick={() => setReason(r)}>{r}</button>)}
          </div>
          <textarea className="input" rows={2} maxLength={200} placeholder="Or type your own reason…" value={reason} onChange={e => setReason(e.target.value)} />
          <div className="field-hint" style={{ textAlign: 'right' }}>{clean.length}/200</div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
          <Button disabled={!clean} loading={busy === 'return'}
            onClick={() => run('return', () => s.write.pt.returnToSender(target.p.id, clean), {
              success: `Return of “${target.p.name}” sent to ${d.name(target.to)}.`,
              onDone: async () => { setTarget(null); await onDone?.() },
            })}>↩ Send back</Button>
        </div>
      </div>
    </Modal>
  )
  return { button, modal }
}

// ── Delete (manufacturer, created by mistake) ───────────────────────────────
/** True if the UI should offer Delete (the contract has the final say). */
export const canDelete = (p, me) =>
  sameAddr(p.manufacturer, me) && sameAddr(p.holder, me) && p.status === 0 && (!p.last || (p.last.kind === KIND.SHIP && p.last.cancelled))

export function useDelete(onDone) {
  const s = useSession()
  const { run, busy } = useTx()
  const [p, setP] = useState(null)
  const button = x => <Button variant="danger" size="sm" disabled={!!busy} onClick={() => setP(x)} title="Delete a product created by mistake">🗑 Delete</Button>
  const modal = p && (
    <Modal title="Delete product?" onClose={() => setP(null)} width={460}>
      <div className="stack">
        <Alert type="warning" title={`“${p.name}” #${p.id}`}>
          This permanently removes the product token. Its record stays on-chain marked <b>Deleted</b> (blockchains never forget),
          but it can no longer be shipped. Only possible because it never left your stock.
        </Alert>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setP(null)}>Keep it</Button>
          <Button variant="danger" loading={busy === 'delete'}
            onClick={() => run('delete', () => s.write.pt.deleteProduct(p.id), { success: `Deleted “${p.name}”.`, onDone: async () => { setP(null); await onDone?.() } })}>
            Delete permanently
          </Button>
        </div>
      </div>
    </Modal>
  )
  return { button, modal }
}

// ── Call back when a licence lapsed ─────────────────────────────────────────
/** Which of these products can be called back right now (licence lapsed). */
export function useReclaimable(products) {
  const key = products.map(p => p.id + ':' + p.status + ':' + (p.holder || '') + ':' + (p.pending || '')).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useLoad(() => (products.length ? loadReclaimable(products) : Promise.resolve({})), [key])
}

export function CallBackButton({ p, info, onDone }) {
  const s = useSession()
  const { run, busy } = useTx()
  if (!info?.ok) return null
  return (
    <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'reclaim:' + p.id} title={info.reason}
      onClick={() => run('reclaim:' + p.id, () => s.write.pt.reclaimProduct(p.id), { success: info.reason, onDone })}>
      ⤺ Call back
    </Button>
  )
}

/** Banner: N shipments can be called back at once. */
export function CallBackBanner({ items, info, onDone }) {
  const s = useSession()
  const { run, busy } = useTx()
  const due = items.filter(p => info?.[p.id]?.ok)
  if (!due.length) return null
  async function all() {
    for (const p of due) {
      const r = await run('reclaim-all', () => s.write.pt.reclaimProduct(p.id), { success: info[p.id].reason })
      if (!r) break
    }
    await onDone?.()
  }
  return (
    <Alert type="warning" title={`${due.length} product${due.length === 1 ? '' : 's'} affected by a revoked or expired licence`}
      action={<Button size="sm" variant="secondary" loading={busy === 'reclaim-all'} onClick={all}>⤺ Call back {due.length === 1 ? 'it' : 'all'}</Button>}>
      {due.slice(0, 3).map(p => <div key={p.id} className="small">#{p.id} {p.name} — {info[p.id].reason}</div>)}
      {due.length > 3 && <div className="small">…and {due.length - 3} more</div>}
      <div className="small faint" style={{ marginTop: 4 }}>If the automatic keeper is running, in-transit shipments revert on their own within a few minutes.</div>
    </Alert>
  )
}

// ── Incoming shipments (ships + returns) ────────────────────────────────────
/** Products currently shipped / returned to me and awaiting my confirmation. */
export function useIncoming() {
  const s = useSession()
  return useLoad(async () => {
    const ids = await reader().pt.getShipmentsTo(s.address)
    return (await loadProducts(ids)).filter(p => p.status === 1 && sameAddr(p.pending, s.address))
  }, [s.address])
}

export function IncomingList({ incoming, onAccepted, emptyText, groupKey, groupTitle, groupExtra }) {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const { buttons, modals } = useProductModals()
  if (incoming.loading) return <Loading />
  if (incoming.error) return <Alert type="error">{incoming.error}</Alert>
  if (!incoming.data.length) return <Empty icon="📬" title="No incoming shipments">{emptyText}</Empty>

  const row = p => (
    <ProductItem key={p.id} p={p} actions={<>
      {buttons(p)}
      <Button variant="success" size="sm" disabled={!!busy} loading={busy === 'accept:' + p.id}
        onClick={() => run('accept:' + p.id, () => s.write.pt.confirmReceipt(p.id), {
          success: p.last?.kind === KIND.RETURN ? `Return of “${p.name}” accepted from ${d.name(p.holder)}.` : `Received “${p.name}” from ${d.name(p.holder)}.`,
          onDone: onAccepted,
        })}>
        ✓ {p.last?.kind === KIND.RETURN ? 'Accept return' : 'Accept shipment'}
      </Button>
    </>} />
  )
  return (
    <>
      {groupKey
        ? groupBy(incoming.data, groupKey).map(([k, items]) => (
          <GroupBox key={k} address={items[0] && groupKey(items[0])} title={groupTitle} count={items.length} extra={groupExtra?.(groupKey(items[0]))}>
            {items.map(row)}
          </GroupBox>
        ))
        : incoming.data.map(row)}
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

