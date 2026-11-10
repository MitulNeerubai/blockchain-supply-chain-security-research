import { useState } from 'react'
import { reader, loadAuditLog } from '../lib/chain'
import { useDirectory, useLoad, useSession, useTx } from '../lib/app'
import { fmtDate, fmtDateTime } from '../lib/format'
import { Alert, Button, Card, Empty, Entity, Loading, Pill, Stat, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { ProductLookup } from '../components/Products'

export default function RootGA() {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const [tab, setTab] = useState('lg')
  const [filter, setFilter] = useState('all')

  const lgs = useLoad(async () => {
    const { trust } = reader()
    const list = d.byRole('LocalGovt')
    const info = await Promise.all(list.map(x => Promise.all([trust.isAuthorizedIssuer(x.address), trust.authorizedAt(x.address)])))
    return list.map((x, i) => {
      const [ok, at] = info[i]
      return { ...x, licensed: ok, since: Number(at), state: ok ? 'licensed' : Number(at) ? 'revoked' : 'pending' }
    }).sort((a, b) => ({ pending: 0, licensed: 1, revoked: 2 }[a.state] - { pending: 0, licensed: 1, revoked: 2 }[b.state]) || b.createdAt - a.createdAt)
  }, [d.dir])

  const totals = useLoad(async () => Number(await reader().pt.totalProducts()), [])
  const log = useLoad(() => (tab === 'audit' ? loadAuditLog(100) : Promise.resolve(null)), [tab])

  const rows = (lgs.data || []).filter(x => filter === 'all' || x.state === filter)
  const count = st => (lgs.data || []).filter(x => x.state === st).length
  const all = [...d.dir.values()]

  const grant = lg => run('grant:' + lg.address, () => s.write.trust.authorizeIssuer(lg.address, 'LocalGovt'), {
    success: `${lg.company} now holds an LG licence.`, onDone: lgs.reload,
  })
  const revoke = lg => run('revoke:' + lg.address, () => s.write.trust.revokeIssuer(lg.address), {
    success: `LG licence of ${lg.company} revoked. Its licensing chain is suspended.`, onDone: lgs.reload,
  })

  return (
    <div className="page">
      <PageHead session={s} title="Root Governance Authority" subtitle="Grant Local Government licences — the root of the chain of trust." />

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        <Stat label="LG licences active" value={lgs.data ? count('licensed') : '…'} hint={`${count('pending')} awaiting approval`} />
        <Stat label="Manufacturers" value={all.filter(x => x.role === 'Manufacturer').length} />
        <Stat label="Distributors" value={all.filter(x => x.role === 'Distributor').length} />
        <Stat label="Retailers" value={all.filter(x => x.role === 'Retailer').length} />
        <Stat label="Products created" value={totals.data ?? '…'} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'lg', label: 'Local Governments', icon: '🏢', count: lgs.data?.length },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'audit', label: 'Audit trail', icon: '📜' },
      ]} />

      {tab === 'lg' && (
        <Card
          title="Local Government registrations"
          subtitle="Only companies registered with the Local Government role are listed."
          bodyClass="tight"
          actions={
            <div className="chips">
              {[['all', 'All'], ['pending', `Pending (${count('pending')})`], ['licensed', 'Licensed'], ['revoked', 'Revoked']].map(([k, l]) => (
                <button key={k} className={`chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
          }
        >
          {lgs.loading ? <Loading /> : lgs.error ? <div className="card-body"><Alert type="error">{lgs.error}</Alert></div>
            : !rows.length ? <Empty icon="🏢" title={filter === 'all' ? 'No Local Governments registered yet' : 'Nothing here'}>Local Governments appear here after they register on the Register page with the “Local Government” role.</Empty>
            : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Company</th><th>DID</th><th>Registered</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {rows.map(lg => (
                      <tr key={lg.address}>
                        <td><Entity address={lg.address} name={lg.company} role="LocalGovt" /></td>
                        <td className="mono small faint">{lg.did.slice(0, 22)}…</td>
                        <td className="nowrap">{fmtDate(lg.createdAt)}</td>
                        <td>
                          {lg.state === 'licensed' ? <Pill tone="green" dot>Licensed · {fmtDate(lg.since)}</Pill>
                            : lg.state === 'revoked' ? <Pill tone="red" dot>Revoked</Pill>
                            : <Pill tone="amber" dot>Pending approval</Pill>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {lg.licensed
                            ? <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'revoke:' + lg.address} onClick={() => revoke(lg)}>Revoke licence</Button>
                            : <Button variant="success" size="sm" disabled={!!busy || !lg.active} loading={busy === 'grant:' + lg.address} onClick={() => grant(lg)}>{lg.state === 'revoked' ? 'Re-grant licence' : 'Grant LG licence'}</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      )}

      {tab === 'lookup' && <ProductLookup />}

      {tab === 'audit' && (
        <Card title="On-chain audit trail" subtitle="Latest 100 entries written by the DID, Credential and Product contracts." bodyClass="tight"
          actions={<Button variant="ghost" size="sm" onClick={log.reload}>↻ Refresh</Button>}>
          {log.loading || !log.data ? <Loading /> : log.error ? <div className="card-body"><Alert type="error">{log.error}</Alert></div>
            : !log.data.length ? <Empty icon="📜" title="No entries yet" />
            : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
                  <tbody>
                    {log.data.map(e => (
                      <tr key={e.index}>
                        <td className="faint">{e.index}</td>
                        <td className="nowrap small">{fmtDateTime(e.timestamp)}</td>
                        <td><Entity address={e.actor} name={d.get(e.actor)?.company} role={d.get(e.actor)?.role} size={26} /></td>
                        <td><code>{e.action}</code></td>
                        <td className="small muted" style={{ maxWidth: 380, wordBreak: 'break-all' }}>{e.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      )}
    </div>
  )
}
