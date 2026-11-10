import { useState } from 'react'
import { loadProducts, reader } from '../lib/chain'
import { useDirectory, useLoad, useNetwork, useSession, useTx } from '../lib/app'
import { sameAddr } from '../lib/format'
import { Alert, Button, Card, Empty, Entity, Loading, Stat, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { LicenceBanner, LicencePanel, useActiveLicensees, useStanding } from '../components/Licences'
import { ProductLookup } from '../components/Products'
import { EmailSettings } from '../components/EmailSettings'
import DashFrame from '../components/DashFrame'
import {
  CallBackBanner, CallBackButton, FilterChips, GroupBox, IncomingList, PairPill, ProductItem, ShipForm,
  groupBy, useIncoming, useProductModals, useReclaimable, useReturn,
} from '../components/ProductList'

export default function Distributor() {
  const s = useSession()
  const d = useDirectory()
  const net = useNetwork()
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

  const watch = [...groups.transit, ...groups.retail]
  const rc = useReclaimable(watch)
  const reloadAll = async () => { await Promise.all([held.reload(), incoming.reload()]); rc.reload() }
  const ret = useReturn(reloadAll)
  const cancel = p => run('cancel:' + p.id, () => s.write.pt.cancelShipment(p.id), { success: 'Shipment cancelled — product is back in stock.', onDone: reloadAll })
  const recall = p => run('recall:' + p.id, () => s.write.pt.forceRecall(p.id), { success: `“${p.name}” recalled from ${d.name(p.holder)}.`, onDone: reloadAll })

  // Inside each manufacturer box: one sub-box per destination
  //   'stock'      → still with me
  //   <retailer>   → in transit to it, or delivered there
  //   <mf>         → being returned to the manufacturer
  const destOf = p => (p.status === 0 && mine(p) ? 'stock' : mine(p) ? p.pending : p.holder)
  // Stock first; show an empty "In your stock" box under the All filter
  function subGroups(list0) {
    const g = groupBy(list0, destOf).sort(([a], [b]) => (a === 'stock' ? -1 : b === 'stock' ? 1 : 0))
    if (filter === 'all' && !g.some(([k]) => k === 'stock')) g.unshift(['stock', []])
    return g
  }

  const productRow = (p, ok) => (
    <ProductItem key={p.id} p={p}
      warn={rc.data?.[p.id]?.ok ? rc.data[p.id].reason : null}
      actions={<>
        {buttons(p)}
        {p.status === 0 && mine(p) && ret.button(p)}
        {p.status === 1 && mine(p) && !rc.data?.[p.id]?.ok && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'cancel:' + p.id} onClick={() => cancel(p)}>Cancel shipment</Button>}
        <CallBackButton p={p} info={rc.data?.[p.id]} onDone={reloadAll} />
        {p.status === 2 && !mine(p) && !rc.data?.[p.id]?.ok && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'recall:' + p.id} onClick={() => recall(p)}>Force recall</Button>}
      </>}
      foot={p.status === 0 && mine(p) && ok && <ShipForm product={p} partners={partners.data || []} partnerLabel="Retailer" onShipped={reloadAll} />}
    />
  )

  function renderSub(dest, sub, manufacturer) {
    const ok = licFrom(manufacturer)?.active
    if (dest === 'stock') {
      return (
        <div className="subgroup" key="stock">
          <div className="subgroup-head"><span className="strong">📦 In your stock</span><span className="tab-count">{sub.length}</span></div>
          {sub.length ? sub.map(p => productRow(p, ok)) : <p className="faint small">Nothing from {d.name(manufacturer)} in stock right now.</p>}
        </div>
      )
    }
    dest = destOf(sub[0])              // original-case address (group keys are lowercased)
    const who = d.get(dest)
    const returning = sameAddr(dest, manufacturer)
    const inTransit = sub.filter(p => p.status === 1).length
    const delivered = sub.filter(p => p.status === 2).length
    return (
      <div className="subgroup" key={dest}>
        <div className="subgroup-head">
          <Entity address={dest} name={who?.company} role={who?.role} size={26}
            sub={returning ? 'Returning to manufacturer' : [inTransit && `${inTransit} in transit`, delivered && `${delivered} delivered`].filter(Boolean).join(' · ') || 'Retailer'} />
          <div className="row" style={{ gap: 8 }}>
            {!returning && <PairPill issuer={s.address} holder={dest} />}
            <span className="tab-count">{sub.length}</span>
          </div>
        </div>
        {sub.map(p => productRow(p, ok))}
      </div>
    )
  }

  // Licence from each manufacturer decides what I may do with its products
  const licFrom = mf => net.pair(mf, s.address)
  const mfBoxes = groupBy(shown, p => p.manufacturer)
  const myManufacturers = net.held(s.address)

  const facts = {
    loading: standing.loading || held.loading || partners.loading,
    licensed: !!standing.data?.ok,
    partners: partners.data?.length || 0,
    received: list.length > 0,
    shipped: list.some(p => !mine(p) || p.status === 1),
  }

  return (
    <DashFrame facts={facts} onGo={setTab}>
      <PageHead session={s} title={s.company} />
      <div style={{ marginBottom: 20 }}><LicenceBanner standing={standing} /></div>

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        <Stat label="Incoming" value={incoming.data?.length ?? '…'} hint="awaiting your confirmation" />
        <Stat label="In stock" value={groups.stock.length} />
        <Stat label="In transit" value={groups.transit.length} />
        <Stat label="At retailers" value={groups.retail.length} />
        <Stat label="Manufacturers" value={myManufacturers.filter(c => c.active).length} hint={`${partners.data?.length ?? '…'} retailers licensed`} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'incoming', label: 'Incoming', icon: '📬', count: incoming.data?.length },
        { id: 'inventory', label: 'Inventory', icon: '📦', count: groups.all.length },
        { id: 'partners', label: 'Retailers', icon: '🏪', count: partners.data?.length },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'email', label: 'Notifications', icon: '📧' },
      ]} />

      {tab === 'incoming' && (
        <Card title="Incoming shipments" subtitle="One box per Manufacturer. Includes products retailers returned to you. Accept to take custody." actions={<Button variant="ghost" size="sm" onClick={incoming.reload}>↻ Refresh</Button>}>
          <IncomingList incoming={incoming} onAccepted={reloadAll} emptyText="Shipments from the Manufacturers that licensed you appear here."
            groupKey={p => p.manufacturer} groupTitle="Manufacturer" groupExtra={mf => <PairPill issuer={mf} holder={s.address} />} />
        </Card>
      )}

      {tab === 'inventory' && (
        <div className="stack">
          <CallBackBanner items={watch} info={rc.data} onDone={reloadAll} />
          <Card title="Inventory by manufacturer" subtitle="Each Manufacturer you work with has its own box. You can only ship a Manufacturer's products while your licence from it is active."
            actions={<Button variant="ghost" size="sm" onClick={() => { reloadAll(); partners.reload() }}>↻ Refresh</Button>}>
            <div style={{ marginBottom: 14 }}>
              <FilterChips value={filter} onChange={setFilter} options={[
                ['all', 'All', groups.all.length], ['stock', 'In stock', groups.stock.length], ['transit', 'In transit', groups.transit.length], ['retail', 'At retailers', groups.retail.length],
              ]} />
            </div>
            {held.loading ? <Loading /> : held.error ? <Alert type="error">{held.error}</Alert>
              : !shown.length ? <Empty icon="📦" title="Nothing here yet">Accepted shipments appear in your inventory, grouped by manufacturer.</Empty>
              : mfBoxes.map(([k, items]) => {
                const mf = items[0].manufacturer
                const lic = licFrom(mf)
                const ok = lic?.active
                return (
                  <GroupBox key={k} address={mf} title="Manufacturer" count={items.length} extra={<PairPill issuer={mf} holder={s.address} />}>
                    {!ok && (
                      <div style={{ marginBottom: 10 }}>
                        <Alert type="warning" title={`Your licence from ${d.name(mf)} is ${lic ? lic.status : 'missing'}`}>
                          You cannot ship these products to retailers. Return them, or ask {d.name(mf)} to renew your licence — they can also call them back.
                        </Alert>
                      </div>
                    )}
                    {subGroups(items).map(([dk, sub]) => renderSub(dk, sub, mf))}
                  </GroupBox>
                )
              })}
          </Card>
        </div>
      )}

      {tab === 'partners' && <LicencePanel standing={standing} onChange={partners.reload} />}
      {tab === 'lookup' && <ProductLookup />}
      {tab === 'email' && <EmailSettings address={s.address} signer={s.signer} />}
      {modals}
      {ret.modal}
    </DashFrame>
  )
}
