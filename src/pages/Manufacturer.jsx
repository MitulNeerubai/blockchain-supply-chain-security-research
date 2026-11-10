import { useState } from 'react'
import { loadProducts, reader } from '../lib/chain'
import { useLoad, useSession, useTx, useDirectory } from '../lib/app'
import { sameAddr } from '../lib/format'
import { Alert, Button, Card, Empty, Field, Loading, Stat, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { LicenceBanner, LicencePanel, useActiveLicensees, useStanding } from '../components/Licences'
import { ProductLookup } from '../components/Products'
import { EmailSettings } from '../components/EmailSettings'
import { FilterChips, ProductItem, ShipForm, useProductModals } from '../components/ProductList'

const EMPTY_FORM = { name: '', quantity: '1', description: '', batch: '' }

export default function Manufacturer() {
  const s = useSession()
  const d = useDirectory()
  const standing = useStanding()
  const partners = useActiveLicensees()
  const { run, busy } = useTx()
  const { buttons, modals } = useProductModals()
  const [tab, setTab] = useState('products')
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(EMPTY_FORM)

  const products = useLoad(async () => loadProducts(await reader().pt.getManufacturerProducts(s.address)), [s.address])
  const list = products.data || []
  const mine = p => sameAddr(p.holder, s.address)
  const groups = {
    all: list,
    stock: list.filter(p => p.status === 0 && mine(p)),
    transit: list.filter(p => p.status === 1),
    downstream: list.filter(p => p.status === 0 && !mine(p)),
    delivered: list.filter(p => p.status === 2),
    cancelled: list.filter(p => p.status === 3),
  }
  const shown = groups[filter]
  const canCreate = standing.data?.ok
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function create(e) {
    e.preventDefault()
    const qty = Number(form.quantity)
    if (!form.name.trim() || !(qty >= 1)) return
    await run('create', () => s.write.pt.createProduct(form.name.trim(), '', BigInt(Math.floor(qty)), form.description.trim(), form.batch.trim()), {
      success: `Product “${form.name.trim()}” created.`,
      onDone: async () => { setForm(EMPTY_FORM); setFilter('stock'); await products.reload() },
    })
  }

  const recall = p => run('recall:' + p.id, () => s.write.pt.forceRecall(p.id), { success: `“${p.name}” recalled to your inventory.`, onDone: products.reload })
  const cancel = p => run('cancel:' + p.id, () => s.write.pt.cancelShipment(p.id), { success: 'Shipment cancelled — product is back in stock.', onDone: products.reload })

  function actionsFor(p) {
    return (
      <>
        {buttons(p)}
        {p.status === 1 && mine(p) && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'cancel:' + p.id} onClick={() => cancel(p)}>Cancel shipment</Button>}
        {p.status !== 3 && !mine(p) && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'recall:' + p.id} onClick={() => recall(p)}>Force recall</Button>}
      </>
    )
  }

  return (
    <div className="page">
      <PageHead session={s} title={s.company} />
      <div style={{ marginBottom: 20 }}><LicenceBanner standing={standing} /></div>

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        <Stat label="In stock" value={groups.stock.length} />
        <Stat label="In transit" value={groups.transit.length} />
        <Stat label="With partners" value={groups.downstream.length + groups.delivered.length} hint={`${groups.delivered.length} delivered to retailers`} />
        <Stat label="Active distributors" value={partners.data?.length ?? '…'} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'products', label: 'Products', icon: '📦', count: list.length },
        { id: 'partners', label: 'Distributors', icon: '🚚', count: partners.data?.length },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'email', label: 'Notifications', icon: '📧' },
      ]} />

      {tab === 'products' && (
        <div className="grid grid-aside">
          <Card title="Create a product" subtitle="Mints a product token in your name. Requires an active Manufacturing License.">
            {!canCreate && !standing.loading && <div style={{ marginBottom: 14 }}><Alert type="warning">You need an active Manufacturing License to create products.</Alert></div>}
            <form className="form" onSubmit={create}>
              <Field label="Product name"><input className="input" placeholder="e.g. Widget Model X" value={form.name} onChange={set('name')} disabled={!canCreate} maxLength={80} /></Field>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Quantity"><input className="input" type="number" min="1" value={form.quantity} onChange={set('quantity')} disabled={!canCreate} /></Field>
                <Field label="Batch number"><input className="input" placeholder="BATCH-001" value={form.batch} onChange={set('batch')} disabled={!canCreate} maxLength={40} /></Field>
              </div>
              <Field label="Description" hint="Optional"><input className="input" placeholder="e.g. Electronics, 12V" value={form.description} onChange={set('description')} disabled={!canCreate} maxLength={200} /></Field>
              <Button type="submit" block loading={busy === 'create'} disabled={!canCreate || !form.name.trim() || !(Number(form.quantity) >= 1)}>📦 Create product</Button>
            </form>
          </Card>

          <Card title="Your products" bodyClass="" actions={<Button variant="ghost" size="sm" onClick={() => { products.reload(); partners.reload() }}>↻ Refresh</Button>}>
            <div style={{ marginBottom: 14 }}>
              <FilterChips value={filter} onChange={setFilter} options={[
                ['all', 'All', groups.all.length], ['stock', 'In stock', groups.stock.length], ['transit', 'In transit', groups.transit.length],
                ['downstream', 'At distributor', groups.downstream.length], ['delivered', 'Delivered', groups.delivered.length], ['cancelled', 'Cancelled', groups.cancelled.length],
              ]} />
            </div>
            {products.loading ? <Loading /> : products.error ? <Alert type="error">{products.error}</Alert>
              : !shown.length ? <Empty icon="📦" title={list.length ? 'Nothing in this view' : 'No products yet'}>{list.length ? 'Try another filter.' : 'Create your first product on the left.'}</Empty>
              : shown.map(p => (
                <ProductItem key={p.id} p={p} actions={actionsFor(p)}
                  foot={p.status === 0 && mine(p) && (
                    <ShipForm product={p} partners={partners.data || []} partnerLabel="Distributor" onShipped={products.reload} />
                  )} />
              ))}
          </Card>
        </div>
      )}

      {tab === 'partners' && <LicencePanel standing={standing} onChange={partners.reload} />}
      {tab === 'lookup' && <ProductLookup />}
      {tab === 'email' && <EmailSettings address={s.address} signer={s.signer} />}
      {modals}
      {d.error && <Alert type="error">{d.error}</Alert>}
    </div>
  )
}
