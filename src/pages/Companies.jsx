import { useMemo, useState } from 'react'
import { useDirectory, useNetwork, useProfile } from '../lib/app'
import { ROLES, ROLE_ICON, ROLE_LABEL, fmtDate } from '../lib/format'
import { Alert, Button, Card, Empty, Entity, Loading, Pill, RoleBadge, Tabs } from '../components/ui'
import { FilterChips } from '../components/ProductList'
import { TrustTree } from '../components/Network'

const TONE = { active: 'green', pending: 'amber', suspended: 'amber', revoked: 'red', expired: 'gray', unknown: 'gray' }

export function CompanyCard({ c }) {
  const net = useNetwork()
  const profile = useProfile()
  const st = net.statusOf(c.address)
  const held = net.held(c.address)
  const issued = net.issued(c.address)
  return (
    <div className="card company-card">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <Entity address={c.address} name={c.company} role={c.role} size={38} />
        <RoleBadge role={c.role} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <Pill tone={TONE[st.state]} dot>{st.label}</Pill>
      </div>
      <div className="company-meta">
        {c.role !== 'LocalGovt' && <span>Licensed by {held.filter(x => x.active).length || 0}</span>}
        {c.role !== 'Retailer' && <span>Licensed {issued.filter(x => x.active).length} {c.role === 'LocalGovt' ? 'manufacturers' : c.role === 'Manufacturer' ? 'distributors' : 'retailers'}</span>}
        <span>Since {fmtDate(c.createdAt)}</span>
      </div>
      <Button variant="secondary" size="sm" block style={{ marginTop: 12 }} onClick={() => profile.open(c.address)}>View profile</Button>
    </div>
  )
}

export default function Companies() {
  const d = useDirectory()
  const net = useNetwork()
  const [tab, setTab] = useState('dir')
  const [role, setRole] = useState('all')
  const [q, setQ] = useState('')
  const all = useMemo(() => [...d.dir.values()], [d.dir])
  const shown = all
    .filter(c => (role === 'all' || c.role === role) && (!q.trim() || c.company.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.company.localeCompare(b.company))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Companies</h1>
          <p className="page-sub">Every registered account, its role and live licence status, and who licensed whom. Public — no wallet needed.</p>
        </div>
        <Button variant="ghost" onClick={() => { d.refresh(); net.refresh() }}>↻ Refresh</Button>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        {ROLES.map(r => (
          <div key={r} className="card stat clickable-card" onClick={() => { setTab('dir'); setRole(r) }}>
            <div className="stat-label">{ROLE_ICON[r]} {ROLE_LABEL[r]}s</div>
            <div className="stat-value">{all.filter(c => c.role === r).length}</div>
            <div className="stat-hint">{all.filter(c => c.role === r && net.statusOf(c.address).state === 'active').length} active</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'dir', label: 'Directory', icon: '🏢', count: all.length },
        { id: 'tree', label: 'Trust map', icon: '🌳' },
      ]} />

      {tab === 'dir' && (
        <div className="stack">
          <div className="row">
            <input className="input grow" style={{ maxWidth: 320 }} placeholder="Search company name…" value={q} onChange={e => setQ(e.target.value)} />
            <FilterChips value={role} onChange={setRole} options={[['all', 'All', all.length], ...ROLES.map(r => [r, ROLE_LABEL[r], all.filter(c => c.role === r).length])]} />
          </div>
          {d.loading ? <Loading /> : d.error ? <Alert type="error">{d.error}</Alert>
            : !shown.length ? <Empty icon="🏢" title="No companies match" />
            : <div className="grid grid-3">{shown.map(c => <CompanyCard key={c.address} c={c} />)}</div>}
        </div>
      )}

      {tab === 'tree' && (
        <Card title="Trust hierarchy" subtitle="Root Authority → Local Governments → Manufacturers → Distributors → Retailers. A Distributor that works for several Manufacturers appears under each of them. Click any company for its profile.">
          <TrustTree />
        </Card>
      )}
    </div>
  )
}
