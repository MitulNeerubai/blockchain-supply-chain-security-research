import { useEffect, useState } from 'react'
import { loadProducts, reader } from '../lib/chain'
import { useLoad, useSession, useTx } from '../lib/app'
import { PRODUCT_LIMITS, sameAddr, validateProduct } from '../lib/format'
import { Alert, Button, Card, Empty, Field, Loading, Stat, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { LicenceBanner, LicencePanel, useActiveLicensees, useStanding } from '../components/Licences'
import { ProductLookup } from '../components/Products'
import { EmailSettings } from '../components/EmailSettings'
import DashFrame from '../components/DashFrame'
import {
  CallBackBanner, CallBackButton, FilterChips, IncomingList, ProductItem, ShipForm,
  canDelete, useDelete, useIncoming, useProductModals, useReclaimable,
} from '../components/ProductList'

const EMPTY_FORM = { name: '', quantity: '1', description: '', batch: '' }

export default function Manufacturer() {
  const s = useSession()
  const standing = useStanding()
  const partners = useActiveLicensees()
  const incoming = useIncoming()
  const { run, busy } = useTx()
  const { buttons, modals } = useProductModals()
  const [tab, setTab] = useState('products')
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(EMPTY_FORM)
  const [touched, setTouched] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [showForm, setShowForm] = useState(true)

  const products = useLoad(async () => loadProducts(await reader().pt.getManufacturerProducts(s.address)), [s.address])
  const list = products.data || []
  const mine = p => sameAddr(p.holder, s.address)
  const groups = {
    all: list.filter(p => p.status !== 3),
    stock: list.filter(p => p.status === 0 && mine(p)),
    transit: list.filter(p => p.status === 1),
    downstream: list.filter(p => p.status === 0 && !mine(p)),
    delivered: list.filter(p => p.status === 2),
    deleted: list.filter(p => p.status === 3),
  }
  const shown = groups[filter]
  const canCreate = standing.data?.ok

  // Products whose licence situation lets us call them back
  const watch = list.filter(p => p.status === 1 || ((p.status === 0 || p.status === 2) && !mine(p)))
  const rc = useReclaimable(watch)
  const reloadAll = async () => { await Promise.all([products.reload(), incoming.reload()]); rc.reload() }
  const del = useDelete(reloadAll)

  // Live check: batch numbers are unique per manufacturer (enforced by the contract too)
  const [batchTaken, setBatchTaken] = useState(null) // product id using it, or null
  const batchClean = form.batch.trim()
  useEffect(() => {
    setBatchTaken(null)
    if (!batchClean) return
    const t = setTimeout(async () => {
      try { const id = Number(await reader().pt.batchUsedBy(s.address, batchClean)); setBatchTaken(id || null) }
      catch { /* older contract without the check */ }
    }, 350)
    return () => clearTimeout(t)
  }, [batchClean, s.address, products.data])

  const errors = validateProduct(form)
  if (!errors.batch && batchTaken) errors.batch = `You already used batch “${batchClean}” for product #${batchTaken}. Batch numbers must be unique.`
  const showErr = k => (touched[k] || submitted || (k === 'batch' && batchTaken)) && errors[k]
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const blur = k => () => setTouched(t => ({ ...t, [k]: true }))

  async function create(e) {
    e.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length) return
    const f = { name: form.name.trim(), batch: form.batch.trim(), description: form.description.trim(), qty: BigInt(form.quantity.trim()) }
    await run('create', () => s.write.pt.createProduct(f.name, '', f.qty, f.description, f.batch), {
      success: `Product “${f.name}” created.`,
      onDone: async () => { setForm(EMPTY_FORM); setTouched({}); setSubmitted(false); setFilter('stock'); await products.reload() },
    })
  }

  const recall = p => run('recall:' + p.id, () => s.write.pt.forceRecall(p.id), { success: `“${p.name}” recalled to your inventory.`, onDone: reloadAll })
  const cancel = p => run('cancel:' + p.id, () => s.write.pt.cancelShipment(p.id), { success: 'Shipment cancelled — product is back in stock.', onDone: reloadAll })

  function actionsFor(p) {
    const info = rc.data?.[p.id]
    return (
      <>
        {buttons(p)}
        {p.status === 1 && mine(p) && !info?.ok && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'cancel:' + p.id} onClick={() => cancel(p)}>Cancel shipment</Button>}
        <CallBackButton p={p} info={info} onDone={reloadAll} />
        {p.status !== 3 && !mine(p) && !info?.ok && <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'recall:' + p.id} onClick={() => recall(p)} title="Pull this product back from wherever it is">Force recall</Button>}
        {canDelete(p, s.address) && del.button(p)}
      </>
    )
  }

  const facts = {
    loading: standing.loading || products.loading || partners.loading,
    licensed: !!standing.data?.ok,
    partners: partners.data?.length || 0,
    products: list.length,
    shipped: list.some(p => p.status !== 3 && (p.status !== 0 || !mine(p))),
    delivered: groups.delivered.length > 0,
  }

  return (
    <DashFrame facts={facts} onGo={setTab}>
      <PageHead session={s} title={s.company} />
      <div style={{ marginBottom: 20 }}><LicenceBanner standing={standing} /></div>

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        <Stat label="In stock" value={groups.stock.length} />
        <Stat label="In transit" value={groups.transit.length} />
        <Stat label="With partners" value={groups.downstream.length + groups.delivered.length} hint={`${groups.delivered.length} delivered to retailers`} />
        <Stat label="Returns waiting" value={incoming.data?.length ?? '…'} />
        <Stat label="Active distributors" value={partners.data?.length ?? '…'} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'products', label: 'Products', icon: '📦', count: groups.all.length },
        { id: 'returns', label: 'Returns', icon: '↩', count: incoming.data?.length },
        { id: 'partners', label: 'Distributors', icon: '🚚', count: partners.data?.length },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'email', label: 'Notifications', icon: '📧' },
      ]} />

      {tab === 'products' && (
        <div className="stack">
          <CallBackBanner items={watch} info={rc.data} onDone={reloadAll} />
          <div className="stack">
            <Card title="Create a product" subtitle="Mints a product token in your name. All fields are required."
              actions={<Button variant="ghost" size="sm" onClick={() => setShowForm(v => !v)}>{showForm ? 'Hide form ▴' : '+ New product ▾'}</Button>}>
              {!showForm ? <p className="faint small">Click “+ New product” to open the form.</p> : <>
              {!canCreate && !standing.loading && <div style={{ marginBottom: 14 }}><Alert type="warning">You need an active Manufacturing License to create products.</Alert></div>}
              <form className="form" onSubmit={create} noValidate>
                <div className="form-grid">
                  <Field label="Product name *" error={showErr('name')} hint={`${form.name.trim().length}/${PRODUCT_LIMITS.name}`}>
                    <input className={`input${showErr('name') ? ' invalid' : ''}`} placeholder="e.g. Widget Model X" value={form.name} onChange={set('name')} onBlur={blur('name')} disabled={!canCreate} maxLength={PRODUCT_LIMITS.name} />
                  </Field>
                  <Field label="Quantity *" error={showErr('quantity')}>
                    <input className={`input${showErr('quantity') ? ' invalid' : ''}`} type="number" min="1" step="1" value={form.quantity} onChange={set('quantity')} onBlur={blur('quantity')} disabled={!canCreate} />
                  </Field>
                  <Field label="Batch number *" error={showErr('batch')}>
                    <input className={`input${showErr('batch') ? ' invalid' : ''}`} placeholder="BATCH-001" value={form.batch} onChange={set('batch')} onBlur={blur('batch')} disabled={!canCreate} maxLength={PRODUCT_LIMITS.batch} />
                  </Field>
                  <div className="span-all">
                    <Field label="Description *" error={showErr('description')} hint={`${form.description.trim().length}/${PRODUCT_LIMITS.description}`}>
                      <textarea className={`input${showErr('description') ? ' invalid' : ''}`} rows={2} placeholder="e.g. Electronics, 12V, 500 g" value={form.description} onChange={set('description')} onBlur={blur('description')} disabled={!canCreate} maxLength={PRODUCT_LIMITS.description} />
                    </Field>
                  </div>
                </div>
                {submitted && Object.keys(errors).length > 0 && <Alert type="error">Fill in all required fields before creating the product.</Alert>}
                <div className="row-between">
                  <p className="faint small">Created one by mistake? You can delete it while it is still in your stock and has never been received by a distributor.</p>
                  <Button type="submit" loading={busy === 'create'} disabled={!canCreate}>📦 Create product</Button>
                </div>
              </form>
              </>}
            </Card>

            <Card title="Your products" bodyClass="" actions={<Button variant="ghost" size="sm" onClick={() => { reloadAll(); partners.reload() }}>↻ Refresh</Button>}>
              <div style={{ marginBottom: 14 }}>
                <FilterChips value={filter} onChange={setFilter} options={[
                  ['all', 'All', groups.all.length], ['stock', 'In stock', groups.stock.length], ['transit', 'In transit', groups.transit.length],
                  ['downstream', 'At distributor', groups.downstream.length], ['delivered', 'Delivered', groups.delivered.length], ['deleted', 'Deleted', groups.deleted.length],
                ]} />
              </div>
              {products.loading ? <Loading /> : products.error ? <Alert type="error">{products.error}</Alert>
                : !shown.length ? <Empty icon="📦" title={list.length ? 'Nothing in this view' : 'No products yet'}>{list.length ? 'Try another filter.' : 'Create your first product on the left.'}</Empty>
                : shown.map(p => (
                  <ProductItem key={p.id} p={p} actions={actionsFor(p)}
                    warn={rc.data?.[p.id]?.ok ? rc.data[p.id].reason : null}
                    foot={p.status === 0 && mine(p) && (
                      <ShipForm product={p} partners={partners.data || []} partnerLabel="Distributor" onShipped={reloadAll} />
                    )} />
                ))}
            </Card>
          </div>
        </div>
      )}

      {tab === 'returns' && (
        <Card title="Returns from distributors" subtitle="Products a distributor sent back to you, with their reason. Accept to take them back into stock." actions={<Button variant="ghost" size="sm" onClick={incoming.reload}>↻ Refresh</Button>}>
          <IncomingList incoming={incoming} onAccepted={reloadAll} emptyText="When a distributor returns one of your products it appears here." groupKey={p => p.holder} groupTitle="Returning distributor" />
        </Card>
      )}

      {tab === 'partners' && <LicencePanel standing={standing} onChange={partners.reload} />}
      {tab === 'lookup' && <ProductLookup />}
      {tab === 'email' && <EmailSettings address={s.address} signer={s.signer} />}
      {modals}
      {del.modal}
    </DashFrame>
  )
}
