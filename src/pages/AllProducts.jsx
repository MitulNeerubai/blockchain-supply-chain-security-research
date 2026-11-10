import { useMemo, useState } from 'react'
import { loadAllProducts } from '../lib/chain'
import { go, useDirectory, useLoad } from '../lib/app'
import { STATUS, fmtDate } from '../lib/format'
import { Alert, Button, Card, CompanyLink, Empty, Loading } from '../components/ui'
import { StatusPill, locationOf } from '../components/Products'
import { FilterChips } from '../components/ProductList'

export const useAllProducts = () => useLoad(loadAllProducts, [])

/** Compact product table, shared by the Overview and Products pages. */
export function ProductTable({ rows }) {
  const d = useDirectory()
  return (
    <div className="table-wrap">
      <table className="table clickable">
        <thead><tr><th>#</th><th>Product</th><th>Manufacturer</th><th>Where it is now</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id} onClick={() => go('/product/' + p.id)} title="Open product page">
              <td className="pid">{p.id}</td>
              <td>
                <a href={`#/product/${p.id}`} className="strong" onClick={e => e.stopPropagation()}>{p.name}</a>
                <div className="faint small">Batch {p.batchNumber || '—'} · Qty {p.quantity}</div>
                {p.last?.note && p.last.note !== 'Cancelled by sender' && <div className="small note-inline">“{p.last.note}”</div>}
              </td>
              <td onClick={e => e.stopPropagation()}><CompanyLink address={p.manufacturer}>{d.name(p.manufacturer)}</CompanyLink></td>
              <td className="small">{locationOf(p, null, d.name)}</td>
              <td><StatusPill status={p.status} /></td>
              <td className="nowrap small">{fmtDate(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AllProducts() {
  const d = useDirectory()
  const all = useAllProducts()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [mf, setMf] = useState('')

  const list = useMemo(() => all.data || [], [all.data])
  const count = st => list.filter(p => p.status === st).length
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return list.filter(p =>
      (status === 'all' || p.status === Number(status)) &&
      (!mf || p.manufacturer.toLowerCase() === mf) &&
      (!term || p.id === term.replace('#', '') || p.name.toLowerCase().includes(term) || (p.batchNumber || '').toLowerCase().includes(term) ||
        d.name(p.manufacturer).toLowerCase().includes(term) || d.name(p.holder).toLowerCase().includes(term)))
  }, [list, q, status, mf, d])

  const manufacturers = [...new Set(list.map(p => p.manufacturer.toLowerCase()))]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">All products</h1>
          <p className="page-sub">Every product ever created on the chain, where it is right now and its status. Public — no wallet needed. Click a row for its full history and verification.</p>
        </div>
        <Button variant="ghost" onClick={all.reload}>↻ Refresh</Button>
      </div>

      <Card bodyClass="tight">
        <div className="card-body stack" style={{ gap: 12 }}>
          <div className="row">
            <input className="input grow" style={{ maxWidth: 360 }} placeholder="Search name, batch, product # or company…" value={q} onChange={e => setQ(e.target.value)} />
            <select className="select" style={{ maxWidth: 260 }} value={mf} onChange={e => setMf(e.target.value)}>
              <option value="">All manufacturers</option>
              {manufacturers.map(a => <option key={a} value={a}>{d.name(a)}</option>)}
            </select>
          </div>
          <FilterChips value={status} onChange={setStatus} options={[
            ['all', 'All', list.length], ...STATUS.map((label, i) => [String(i), label, count(i)]),
          ]} />
        </div>
        {all.loading ? <Loading>Reading every product from the blockchain…</Loading>
          : all.error ? <div className="card-body"><Alert type="error">{all.error}</Alert></div>
          : !shown.length ? <Empty icon="📦" title={list.length ? 'No products match' : 'No products yet'}>{list.length ? 'Try a different search or filter.' : 'Products appear here as soon as a licensed manufacturer creates one.'}</Empty>
          : <ProductTable rows={shown} />}
      </Card>
      <p className="footer-note">{shown.length} of {list.length} products shown</p>
    </div>
  )
}
