import { useState } from 'react'
import { loadProducts, reader } from '../lib/chain'
import { useDirectory, useLoad, useSession, useTx } from '../lib/app'
import { sameAddr } from '../lib/format'
import { Alert, Button, Card, Empty, Loading, Stat, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { LicenceBanner, LicencePanel, useActiveLicensees, useStanding } from '../components/Licences'
import { ProductLookup } from '../components/Products'
import { EmailSettings } from '../components/EmailSettings'
import { FilterChips, IncomingList, ProductItem, ShipForm, useIncoming, useProductModals } from '../components/ProductList'

export default function Distributor() {
  const s = useSession()
  const d = useDirectory()
  const standing = useStanding()
  const partners = useActiveLicensees()
  const incoming = useIncoming()
  const { run, busy } = useTx()
  const { buttons, modals } = useProductModals()
  const [tab, setTab] = useState('incoming')
  const [filter, setFilter] = useState('all')

  const held = useLoad(async () => loadProducts(await reader().pt.getHolderProducts(s.address)), [s.address])
  const list = held.data || []
  const mine = p => sameAddr(p.holder, s.address)
  const groups = {
    stock: list.filter(p => mine(p) && p.status === 0),
    transit: list.filter(p => mine(p) && p.status === 1),
    retail: list.filter(p => !mine(p) && p.status === 2 && d.get(p.holder)?.role === 'Retailer'),
  }
  groups.all = [...groups.stock, ...groups.transit, ...groups.retail]
  const shown = groups[filter]

  const reloadAll = async () => { await Promise.all([held.reload(), incoming.reload()]) }
  const cancel = p => run('cancel:' + p.id, () => s.write.pt.cancelShipment(p.id), { success: 'Shipment cancelled — product is back in stock.', onDone: held.reload })
  const recall = p => run('recall:' + p.id, () => s.write.pt.forceRecall(p.id), { success: `“${p.name}” recalled from ${d.name(p.holder)}.`, onDone: held.reload })

  return (
    <div className="page">
      <PageHead session={s} title={s.company} />
      <div style={{ marginBottom: 20 }}><LicenceBanner standing={standing} /></div>

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        <Stat label="Incoming" value={incoming.data?.length ?? '…'} hint="awaiting your confirmation" />
        <Stat label="In stock" value={groups.stock.length} />
        <Stat label="In transit" value={groups.transit.length} />
        <Stat label="At retailers" value={groups.retail.length} />
        <Stat label="Active retailers" value={partners.data?.length ?? '…'} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'incoming', label: 'Incoming', icon: '📬', count: incoming.data?.length },
        { id: 'inventory', label: 'Inventory', icon: '📦', count: groups.all.length },
        { id: 'partners', label: 'Retailers', icon: '🏪', count: partners.data?.length },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'email', label: 'Notifications', icon: '📧' },
      ]} />

      {tab === 'incoming' && (
        <Card title="Incoming shipments" subtitle="Products your Manufacturer shipped to you. Accept to take custody." actions={<Button variant="ghost" size="sm" onClick={incoming.reload}>↻ Refresh</Button>}>
          <IncomingList incoming={incoming} onAccepted={reloadAll} emptyText="Shipments from your Manufacturer will appear here." />
        </Card>
      )}

      {tab === 'inventory' && (
        <Card title="Inventory" actions={<Button variant="ghost" size="sm" onClick={() => { held.reload(); partners.reload() }}>↻ Refresh</Button>}>
          <div style={{ marginBottom: 14 }}>
            <FilterChips value={filter} onChange={setFilter} options={[
              ['all', 'All', groups.all.length], ['stock', 'In stock', groups.stock.length], ['transit', 'In transit', groups.transit.length], ['retail', 'At retailers', groups.retail.length],
            ]} />
          </div>
          {held.loading ? <Loading /> : held.error ? <Alert type="error">{held.error}</Alert>
            : !shown.length ? <Empty icon="📦" title="Nothing here yet">Accepted shipments appear in your inventory.</Empty>
            : shown.map(p => (
              <ProductItem key={p.id} p={p}
                actions={<>
                  {buttons(p)}
                  {p.status === 1 && mine(p) && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'cancel:' + p.id} onClick={() => cancel(p)}>Cancel shipment</Button>}
                  {p.status === 2 && !mine(p) && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'recall:' + p.id} onClick={() => recall(p)}>Force recall</Button>}
                </>}
                foot={p.status === 0 && mine(p) && <ShipForm product={p} partners={partners.data || []} partnerLabel="Retailer" onShipped={held.reload} />}
              />
            ))}
        </Card>
      )}

      {tab === 'partners' && <LicencePanel standing={standing} onChange={partners.reload} />}
      {tab === 'lookup' && <ProductLookup />}
      {tab === 'email' && <EmailSettings address={s.address} signer={s.signer} />}
      {modals}
    </div>
  )
}
