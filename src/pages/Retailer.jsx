import { useState } from 'react'
import { loadAudit, loadProducts, reader } from '../lib/chain'
import { useLoad, useSession } from '../lib/app'
import { errMsg, sameAddr } from '../lib/format'
import { Alert, Button, Card, Empty, Loading, Stat, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { LicenceBanner, useStanding } from '../components/Licences'
import { AuditVerdict, ProductLookup } from '../components/Products'
import { EmailSettings } from '../components/EmailSettings'
import { IncomingList, ProductItem, useIncoming, useProductModals } from '../components/ProductList'

export default function Retailer() {
  const s = useSession()
  const standing = useStanding()
  const incoming = useIncoming()
  const { buttons, modals } = useProductModals()
  const [tab, setTab] = useState('incoming')
  const [audits, setAudits] = useState({})

  const inv = useLoad(async () => (await loadProducts(await reader().pt.getHolderProducts(s.address))).filter(p => sameAddr(p.holder, s.address)), [s.address])
  const list = inv.data || []
  const verifiedCount = Object.values(audits).filter(a => a?.verified).length

  async function verify(p) {
    setAudits(a => ({ ...a, [p.id]: 'loading' }))
    try { const r = await loadAudit(p.id); setAudits(a => ({ ...a, [p.id]: r })) }
    catch (e) { setAudits(a => ({ ...a, [p.id]: { verified: false, failReason: errMsg(e) } })) }
  }

  return (
    <div className="page">
      <PageHead session={s} title={s.company} />
      <div style={{ marginBottom: 20 }}><LicenceBanner standing={standing} /></div>

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        <Stat label="Incoming" value={incoming.data?.length ?? '…'} hint="awaiting your confirmation" />
        <Stat label="In store" value={list.length} />
        <Stat label="Verified this session" value={verifiedCount} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'incoming', label: 'Incoming', icon: '📬', count: incoming.data?.length },
        { id: 'inventory', label: 'In store', icon: '🏪', count: list.length },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'email', label: 'Notifications', icon: '📧' },
      ]} />

      {tab === 'incoming' && (
        <Card title="Incoming shipments" subtitle="Products your Distributor shipped to you. Accepting marks them as delivered." actions={<Button variant="ghost" size="sm" onClick={incoming.reload}>↻ Refresh</Button>}>
          <IncomingList incoming={incoming} onAccepted={() => Promise.all([inv.reload(), incoming.reload()])} emptyText="Shipments from your Distributor will appear here." />
        </Card>
      )}

      {tab === 'inventory' && (
        <Card title="In store" subtitle="Verify each product's full chain of custody, then share its QR code with customers." actions={<Button variant="ghost" size="sm" onClick={inv.reload}>↻ Refresh</Button>}>
          {inv.loading ? <Loading /> : inv.error ? <Alert type="error">{inv.error}</Alert>
            : !list.length ? <Empty icon="🏪" title="No products in store">Accepted shipments appear here.</Empty>
            : list.map(p => {
              const a = audits[p.id]
              return (
                <ProductItem key={p.id} p={p}
                  actions={<>{buttons(p)}<Button size="sm" loading={a === 'loading'} onClick={() => verify(p)}>🔍 Verify chain</Button></>}
                  foot={a && a !== 'loading' && <AuditVerdict audit={a} />}
                />
              )
            })}
        </Card>
      )}

      {tab === 'lookup' && <ProductLookup />}
      {tab === 'email' && <EmailSettings address={s.address} signer={s.signer} />}
      {modals}
    </div>
  )
}
