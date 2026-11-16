import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { reader, loadAuditLog } from '../lib/chain'
import { useDirectory, useLoad, useNetwork, useSession, useTx } from '../lib/app'
import { MO_REGIONS, ROLE_LABEL, errMsg, fmtDate, fmtDateTime, nowSec, sameAddr, validateCompanyName, validateRegion } from '../lib/format'
import { Alert, Button, Card, Empty, Entity, Field, Loading, Modal, Pill, Stat, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { ProductLookup } from '../components/Products'
import { TrustTree } from '../components/Network'
import DashFrame from '../components/DashFrame'

/** Licences moved per transaction - keeps each transfer well under Besu's block gas limit. */
const TRANSFER_BATCH = 4
const ORDER = { pending: 0, licensed: 1, revoked: 2 }
const EMPTY_LG = { wallet: '', name: '', region: '' }

export default function RootGA() {
  const s = useSession()
  const d = useDirectory()
  const net = useNetwork()
  const { run, busy } = useTx()
  const [tab, setTab] = useState('lg')
  const [filter, setFilter] = useState('all')
  const [xfer, setXfer] = useState(null)       // LG whose licences are being transferred
  const [confirmRevoke, setConfirmRevoke] = useState(null)

  const lgs = useLoad(async () => {
    const { trust } = reader()
    const list = d.byRole('LocalGovt')
    const info = await Promise.all(list.map(x => Promise.all([trust.isAuthorizedIssuer(x.address), trust.authorizedAt(x.address)])))
    return list.map((x, i) => {
      const [ok, at] = info[i]
      return { ...x, licensed: ok, since: Number(at), state: ok ? 'licensed' : Number(at) ? 'revoked' : 'pending' }
    }).sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || b.createdAt - a.createdAt)
  }, [d.dir])

  const totals = useLoad(async () => Number(await reader().pt.totalProducts()), [])
  const log = useLoad(() => (tab === 'audit' ? loadAuditLog(100) : Promise.resolve(null)), [tab])

  const rows = (lgs.data || []).filter(x => filter === 'all' || x.state === filter)
  const count = st => (lgs.data || []).filter(x => x.state === st).length
  const all = [...d.dir.values()]

  /** Manufacturing Licences of this LG that have not been revoked or expired (live or suspended). */
  const liveOf = lg => net.issued(lg.address).filter(c => !c.revoked && c.expiresAt > nowSec())
  /** LGs that can receive another LG's licences. */
  const targetsFor = lg => (lgs.data || []).filter(x => x.licensed && x.active && !sameAddr(x.address, lg.address))

  const grant = lg => run('grant:' + lg.address, () => s.write.trust.authorizeIssuer(lg.address, 'LocalGovt'), {
    success: `${lg.company} now holds an LG licence.`, onDone: lgs.reload,
  })
  const revoke = lg => run('revoke:' + lg.address, () => s.write.trust.revokeIssuer(lg.address), {
    success: `LG licence of ${lg.company} revoked.`, onDone: lgs.reload,
  })
  const askRevoke = lg => (liveOf(lg).length ? setConfirmRevoke(lg) : revoke(lg))

  const facts = { loading: lgs.loading || totals.loading, lgLicensed: count('licensed'), products: totals.data || 0 }

  return (
    <DashFrame facts={facts} onGo={setTab}>
      <PageHead session={s} title="Root Governance Authority" subtitle="Add Local Governments and grant their licences - the root of the chain of trust." />

      <div className="grid grid-stats" style={{ marginBottom: 20 }}>
        <Stat label="LG licences active" value={lgs.data ? count('licensed') : '…'} hint={count('pending') ? `${count('pending')} awaiting a licence` : undefined} />
        <Stat label="Manufacturers" value={all.filter(x => x.role === 'Manufacturer').length} />
        <Stat label="Distributors" value={all.filter(x => x.role === 'Distributor').length} />
        <Stat label="Retailers" value={all.filter(x => x.role === 'Retailer').length} />
        <Stat label="Products created" value={totals.data ?? '…'} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'lg', label: 'Local Governments', icon: '🏢', count: lgs.data?.length },
        { id: 'tree', label: 'Trust map', icon: '🌳' },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'audit', label: 'Audit trail', icon: '📜' },
      ]} />

      {tab === 'lg' && (
        <div className="stack">
          <AddLocalGovt onAdded={lgs.reload} />

          <Card
            title="Local Governments"
            subtitle="Only you can add a Local Government. Each one licenses the Manufacturers of its region."
            bodyClass="tight"
            actions={
              <div className="chips">
                {[['all', 'All'], ['pending', `No licence yet (${count('pending')})`], ['licensed', 'Licensed'], ['revoked', 'Revoked']].map(([k, l]) => (
                  <button key={k} className={`chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
            }
          >
            {lgs.loading ? <Loading /> : lgs.error ? <div className="card-body"><Alert type="error">{lgs.error}</Alert></div>
              : !rows.length ? <Empty icon="🏢" title={filter === 'all' ? 'No Local Governments yet' : 'Nothing here'}>Add the first one with the form above: its wallet address, name and region.</Empty>
              : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Local Government</th><th>Region</th><th>Manufacturers</th><th>Added</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {rows.map(lg => {
                        const live = liveOf(lg).length
                        const targets = targetsFor(lg)
                        return (
                          <tr key={lg.address}>
                            <td><Entity address={lg.address} name={lg.company} role="LocalGovt" /></td>
                            <td>{lg.region || '-'}</td>
                            <td>{live ? `${live} licensed` : '-'}</td>
                            <td className="nowrap">{fmtDate(lg.createdAt)}</td>
                            <td>
                              {lg.state === 'licensed' ? <Pill tone="green" dot>Licensed · {fmtDate(lg.since)}</Pill>
                                : lg.state === 'revoked' ? <Pill tone="red" dot>Revoked</Pill>
                                : <Pill tone="amber" dot>No licence yet</Pill>}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                {live > 0 && (
                                  <Button variant="secondary" size="sm" disabled={!!busy || !targets.length} onClick={() => setXfer(lg)}
                                    title={targets.length ? 'Hand this Local Government’s Manufacturers to another Local Government' : 'Add and license another Local Government first'}>
                                    ⇄ Transfer
                                  </Button>
                                )}
                                {lg.licensed
                                  ? <Button variant="danger" size="sm" disabled={!!busy} loading={busy === 'revoke:' + lg.address} onClick={() => askRevoke(lg)}>Revoke licence</Button>
                                  : <Button variant="success" size="sm" disabled={!!busy || !lg.active} loading={busy === 'grant:' + lg.address} onClick={() => grant(lg)}>{lg.state === 'revoked' ? 'Re-grant licence' : 'Grant LG licence'}</Button>}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        </div>
      )}

      {tab === 'tree' && <Card title="Trust hierarchy" subtitle="Every licence in the network, from you down to the retailers. Click any company for its profile."><TrustTree highlight={s.address} /></Card>}
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
                        <td><Entity address={e.actor} name={net.isRoot(e.actor) ? 'Root Governance Authority' : d.get(e.actor)?.company} role={net.isRoot(e.actor) ? 'RootGA' : d.get(e.actor)?.role} size={26} /></td>
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

      {confirmRevoke && (
        <RevokeWarning lg={confirmRevoke} live={liveOf(confirmRevoke)} canTransfer={targetsFor(confirmRevoke).length > 0}
          onClose={() => setConfirmRevoke(null)}
          onTransfer={() => { setXfer(confirmRevoke); setConfirmRevoke(null) }}
          onRevoke={() => { const lg = confirmRevoke; setConfirmRevoke(null); revoke(lg) }} />
      )}
      {xfer && (
        <TransferModal lg={xfer} live={liveOf(xfer)} targets={targetsFor(xfer)}
          onClose={() => setXfer(null)} onDone={() => { setXfer(null); lgs.reload() }} />
      )}
    </DashFrame>
  )
}

/** rootGA adds a Local Government: creates its DID (wallet, name, region), then grants the LG licence. */
function AddLocalGovt({ onAdded }) {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const [f, setF] = useState(EMPTY_LG)
  const [submitted, setSubmitted] = useState(false)
  const [avail, setAvail] = useState('idle') // idle | checking | ok | taken

  const wallet = f.wallet.trim(), name = f.name.trim(), region = f.region.trim()
  const existing = ethers.isAddress(wallet) ? d.get(wallet) : null
  const errors = {
    wallet: !wallet ? 'Paste the wallet address of the Local Government.'
      : !ethers.isAddress(wallet) ? 'This is not a valid wallet address (0x followed by 40 characters).'
      : sameAddr(wallet, s.address) ? 'This is your own Root Authority wallet.'
      : existing ? `This wallet is already registered as “${existing.company}” (${ROLE_LABEL[existing.role]}).` : '',
    name: validateCompanyName(f.name) || (avail === 'taken' ? `“${name}” is already registered. Choose a different name.` : ''),
    region: validateRegion(f.region),
  }
  const nameBasicErr = validateCompanyName(f.name)
  useEffect(() => {
    if (!name || nameBasicErr) { setAvail('idle'); return }
    setAvail('checking')
    const t = setTimeout(async () => {
      try { setAvail((await reader().did.isNameAvailable(name)) ? 'ok' : 'taken') } catch { setAvail('idle') }
    }, 350)
    return () => clearTimeout(t)
  }, [name, nameBasicErr])

  const invalid = Object.values(errors).some(Boolean)
  const show = k => (submitted || f[k]) && errors[k]
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }))

  async function add(e) {
    e.preventDefault()
    setSubmitted(true)
    if (invalid || avail === 'checking') return
    const addr = ethers.getAddress(wallet)
    const r1 = await run('addlg', () => s.write.did.registerLocalGovt(addr, name, region), {
      pending: 'Step 1 of 2 - registering the Local Government…', success: `Step 1 of 2 done - ${name} is registered. Now confirm its licence.`, onDone: d.refresh,
    })
    if (!r1) return
    setF(EMPTY_LG); setSubmitted(false)
    await run('addlg', () => s.write.trust.authorizeIssuer(addr, 'LocalGovt'), {
      pending: 'Step 2 of 2 - granting the LG licence…', success: `${name} is now a licensed Local Government for ${region}.`,
    })
    await onAdded?.()
  }

  return (
    <Card title="Add a Local Government" subtitle="Local Governments cannot register themselves. Enter the wallet address they gave you, their name and the region they cover.">
      <form className="form" onSubmit={add} noValidate>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Field label="Wallet address *" error={show('wallet')}>
            <input className={`input mono${show('wallet') ? ' invalid' : ''}`} placeholder="0x…" value={f.wallet} onChange={set('wallet')} spellCheck={false} autoComplete="off" />
          </Field>
          <Field label="Name *" error={show('name')} ok={!errors.name && avail === 'ok' ? '✓ Available' : ''}>
            <input className={`input${show('name') ? ' invalid' : ''}`} placeholder="e.g. Jackson County Licensing Office" maxLength={64} value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Region *" error={show('region')} hint="Pick a suggestion or type your own.">
            <input className={`input${show('region') ? ' invalid' : ''}`} list="lg-regions" placeholder="e.g. Jackson County, MO" maxLength={64} value={f.region} onChange={set('region')} />
            <datalist id="lg-regions">{MO_REGIONS.map(r => <option key={r} value={r} />)}</datalist>
          </Field>
        </div>
        <div className="row-between">
          <p className="faint small">MetaMask asks you to confirm twice: first to register the Local Government, then to grant its licence. Name and region are stored on-chain and cannot be changed later.</p>
          <Button type="submit" loading={busy === 'addlg'} disabled={!!busy}>🏢 Add Local Government</Button>
        </div>
      </form>
    </Card>
  )
}

/** Shown before revoking an LG that still has Manufacturers under it. */
function RevokeWarning({ lg, live, canTransfer, onClose, onTransfer, onRevoke }) {
  const d = useDirectory()
  return (
    <Modal title={`Revoke ${lg.company}?`} onClose={onClose} width={560}>
      <div className="stack">
        <Alert type="warning" title={`${live.length} Manufacturer${live.length > 1 ? 's are' : ' is'} licensed by this Local Government`}>
          Revoking now suspends {live.length > 1 ? 'them' : 'it'} immediately, together with every Distributor and Retailer below. Shipments on the way to those companies are sent back to the sender.
        </Alert>
        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>Affected Manufacturers</div>
          <div className="row" style={{ gap: 14 }}>
            {live.map(c => <Entity key={c.id} address={c.holder} name={d.get(c.holder)?.company} role="Manufacturer" size={24} sub={`until ${fmtDate(c.expiresAt)}`} />)}
          </div>
        </div>
        <p className="muted small">
          {canTransfer
            ? 'To replace this Local Government without disrupting anyone, transfer its licences to another Local Government first.'
            : 'There is no other licensed Local Government to hand them to. Add and license one first if you want to avoid the disruption.'}
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onRevoke}>Revoke anyway</Button>
          {canTransfer && <Button onClick={onTransfer}>⇄ Transfer licences first</Button>}
        </div>
      </div>
    </Modal>
  )
}

/** Hand one LG's Manufacturing Licences to another licensed LG, then (optionally) revoke the old one. */
function TransferModal({ lg, live, targets, onClose, onDone }) {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const [to, setTo] = useState(targets[0]?.address || '')
  const [alsoRevoke, setAlsoRevoke] = useState(lg.licensed)
  const [err, setErr] = useState('')
  const target = targets.find(t => sameAddr(t.address, to))

  async function go() {
    setErr('')
    if (!target) { setErr('Choose the Local Government that takes over.'); return }
    try {
      // Move in batches until the contract reports nothing left.
      for (let i = 0; i < 40; i++) {
        const rc = await run('xfer', () => s.write.cred.transferLicences(lg.address, target.address, TRANSFER_BATCH), {
          pending: 'Moving the licences…', success: `Licences handed to ${target.company}.`,
        })
        if (!rc) return
        const ev = rc.logs.map(l => { try { return s.write.cred.interface.parseLog(l) } catch { return null } }).find(e => e?.name === 'LicencesTransferred')
        if (!ev || ev.args.remaining === 0n) break
      }
      if (alsoRevoke && lg.licensed) {
        await run('xfer', () => s.write.trust.revokeIssuer(lg.address), { pending: `Revoking ${lg.company}…`, success: `LG licence of ${lg.company} revoked. Nobody else was affected.` })
      }
      await onDone()
    } catch (e) { setErr(errMsg(e)) }
  }

  return (
    <Modal title={`Transfer licences of ${lg.company}`} onClose={busy ? () => {} : onClose} width={580}>
      <div className="stack">
        <p className="muted">
          The {live.length} Manufacturing Licence{live.length > 1 ? 's' : ''} issued by <b>{lg.company}</b>{lg.region ? ` (${lg.region})` : ''} will be re-issued by the Local Government you choose,
          with the same expiry dates. The Manufacturers, their Distributors and Retailers keep working without interruption.
        </p>
        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>Manufacturers that move</div>
          <div className="row" style={{ gap: 14 }}>
            {live.map(c => <Entity key={c.id} address={c.holder} name={d.get(c.holder)?.company} role="Manufacturer" size={24} sub={`until ${fmtDate(c.expiresAt)}`} />)}
          </div>
        </div>
        <Field label="Local Government that takes over *">
          <select className="select" value={to} onChange={e => setTo(e.target.value)} disabled={!!busy}>
            {targets.map(t => <option key={t.address} value={t.address}>{t.company}{t.region ? ` - ${t.region}` : ''}</option>)}
          </select>
        </Field>
        {lg.licensed && (
          <label className="check">
            <input type="checkbox" checked={alsoRevoke} onChange={e => setAlsoRevoke(e.target.checked)} disabled={!!busy} />
            <span>Then revoke the LG licence of {lg.company} <span className="faint">(a second confirmation in MetaMask)</span></span>
          </label>
        )}
        {live.length > TRANSFER_BATCH && <p className="faint small">Licences move {TRANSFER_BATCH} at a time, so MetaMask will ask you to confirm {Math.ceil(live.length / TRANSFER_BATCH)} times for the transfer.</p>}
        {err && <Alert type="error">{err}</Alert>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cancel</Button>
          <Button onClick={go} loading={busy === 'xfer'} disabled={!target}>⇄ Transfer {live.length} licence{live.length > 1 ? 's' : ''}</Button>
        </div>
      </div>
    </Modal>
  )
}
