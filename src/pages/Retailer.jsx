import { useState } from 'react'
import { loadAudit, loadProducts, reader } from '../lib/chain'
import { useDirectory, useLoad, useSession, useTx } from '../lib/app'
import { KIND, errMsg, sameAddr } from '../lib/format'
import { Alert, Button, Card, Empty, Entity, Loading, Stat, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { LicenceBanner, useStanding } from '../components/Licences'
import { AuditVerdict, ProductLookup } from '../components/Products'
import { EmailSettings } from '../components/EmailSettings'
import DashFrame from '../components/DashFrame'
import { GroupBox, IncomingList, PairPill, ProductItem, groupBy, useIncoming, useProductModals, useReturn } from '../components/ProductList'

/** The distributor a retailer's product came from. */
const distributorOf = p => (p.last ? (p.last.kind === KIND.SHIP ? p.last.from : p.last.to) : p.manufacturer)

export default function Retailer() {
  const s = useSession()
  const d = useDirectory()
  const standing = useStanding()
  const incoming = useIncoming()
  const { run, busy } = useTx()
  const { buttons, modals } = useProductModals()
  const [tab, setTab] = useState('incoming')
  const [audits, setAudits] = useState({})

  const inv = useLoad(async () => (await loadProducts(await reader().pt.getHolderProducts(s.address))).filter(p => sameAddr(p.holder, s.address)), [s.address])
  const list = inv.data || []
  const verifiedCount = Object.values(audits).filter(a => a?.verified).length
  const reloadAll = () => Promise.all([inv.reload(), incoming.reload()])
  const ret = useReturn(reloadAll)
  const cancel = p => run('cancel:' + p.id, () => s.write.pt.cancelShipment(p.id), { success: 'Return cancelled — product is back in your store.', onDone: reloadAll })

  async function verify(p) {
    setAudits(a => ({ ...a, [p.id]: 'loading' }))
    try { const r = await loadAudit(p.id); setAudits(a => ({ ...a, [p.id]: r })) }
    catch (e) { setAudits(a => ({ ...a, [p.id]: { verified: false, failReason: errMsg(e) } })) }
  }

  const facts = {
    loading: standing.loading || inv.loading,
    licensed: !!standing.data?.ok,
    received: list.length > 0,
    verified: verifiedCount > 0,
  }

  return (
    <DashFrame facts={facts} onGo={setTab}>
      <PageHead session={s} title={s.company} />
      <div style={{ marginBottom: 20 }}><LicenceBanner standing={standing} /></div>

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        <Stat label="Incoming" value={incoming.data?.length ?? '…'} hint="awaiting your confirmation" />
        <Stat label="In store" value={list.filter(p => p.status === 2).length} />
        <Stat label="Being returned" value={list.filter(p => p.status === 1).length} />
        <Stat label="Verified this session" value={verifiedCount} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'incoming', label: 'Incoming', icon: '📬', count: incoming.data?.length },
        { id: 'inventory', label: 'In store', icon: '🏪', count: list.length },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'email', label: 'Notifications', icon: '📧' },
      ]} />

      {tab === 'incoming' && (
        <Card title="Incoming shipments" subtitle="One box per Distributor. Accepting marks the product as delivered." actions={<Button variant="ghost" size="sm" onClick={incoming.reload}>↻ Refresh</Button>}>
          <IncomingList incoming={incoming} onAccepted={reloadAll} emptyText="Shipments from the Distributors that licensed you appear here."
            groupKey={p => p.holder} groupTitle="Distributor" groupExtra={dt => <PairPill issuer={dt} holder={s.address} />} />
        </Card>
      )}

      {tab === 'inventory' && (
        <Card title="In store" subtitle="Verify each product's full chain of custody, share its QR code with customers, or return it to the distributor." actions={<Button variant="ghost" size="sm" onClick={inv.reload}>↻ Refresh</Button>}>
          {inv.loading ? <Loading /> : inv.error ? <Alert type="error">{inv.error}</Alert>
            : !list.length ? <Empty icon="🏪" title="No products in store">Accepted shipments appear here.</Empty>
            : groupBy(list, distributorOf).map(([k, items]) => {
              const dt = distributorOf(items[0])
              return (
                <GroupBox key={k} address={dt} title="Distributor" count={items.length} extra={<PairPill issuer={dt} holder={s.address} />}>
                  {groupBy(items, p => p.manufacturer).map(([mk, sub]) => {
                    const mf = sub[0].manufacturer
                    const who = d.get(mf)
                    const inStore = sub.filter(p => p.status === 2).length
                    const back = sub.filter(p => p.status === 1).length
                    return (
                      <div className="subgroup" key={mk}>
                        <div className="subgroup-head">
                          <Entity address={mf} name={who?.company} role={who?.role} size={26}
                            sub={['Manufacturer', inStore && `${inStore} in store`, back && `${back} being returned`].filter(Boolean).join(' · ')} />
                          <span className="tab-count">{sub.length}</span>
                        </div>
                        {sub.map(p => {
                          const a = audits[p.id]
                          return (
                            <ProductItem key={p.id} p={p}
                              actions={<>
                                {buttons(p)}
                                {p.status === 2 && <Button size="sm" loading={a === 'loading'} onClick={() => verify(p)}>🔍 Verify chain</Button>}
                                {p.status === 2 && ret.button(p)}
                                {p.status === 1 && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'cancel:' + p.id} onClick={() => cancel(p)}>Cancel return</Button>}
                              </>}
                              foot={a && a !== 'loading' && <AuditVerdict audit={a} compact />}
                            />
                          )
                        })}
                      </div>
                    )
                  })}
                </GroupBox>
              )
            })}
        </Card>
      )}

      {tab === 'lookup' && <ProductLookup />}
      {tab === 'email' && <EmailSettings address={s.address} signer={s.signer} />}
      {modals}
      {ret.modal}
    </DashFrame>
  )
}
