import { useMemo, useState } from 'react'
import { reader, loadIssuedBy, loadMyLicence } from '../lib/chain'
import { useDirectory, useLoad, useSession, useTx } from '../lib/app'
import { DAY, ISSUER_OF, LICENSES, LICENSE_LABEL, ROLE_LABEL, daysLeft, fmtDate, nowSec, short, isZero, sameAddr } from '../lib/format'
import { Alert, Button, Card, CredPill, Empty, Entity, Field, Loading, Pill } from './ui'

/** Loads whether the signed-in wallet may act (LG: rootGA licence, others: own live licence). */
export function useStanding() {
  const s = useSession()
  return useLoad(async () => {
    if (s.role === 'LocalGovt') {
      const { trust } = reader()
      const [ok, at] = await Promise.all([trust.isAuthorizedIssuer(s.address), trust.authorizedAt(s.address)])
      return { ok, kind: 'lg', since: Number(at) }
    }
    const lic = await loadMyLicence(s.address)
    return { ok: lic?.status === 'active', kind: 'cred', lic }
  }, [s.address, s.role])
}

/** Banner at the top of each dashboard explaining the wallet's licence. */
export function LicenceBanner({ standing }) {
  const s = useSession()
  const d = useDirectory()
  if (standing.loading) return <div className="card"><Loading>Checking your licence…</Loading></div>
  const st = standing.data

  if (st.kind === 'lg') {
    return (
      <div className={`card licence ${st.ok ? 'ok' : st.since ? 'bad' : 'wait'}`}>
        <div className="licence-icon">{st.ok ? '🏛️' : st.since ? '⛔' : '⏳'}</div>
        <div className="grow">
          <div className="row"><b>Local Government Licence</b><Pill tone={st.ok ? 'green' : st.since ? 'red' : 'amber'} dot>{st.ok ? 'Active' : st.since ? 'Revoked' : 'Pending approval'}</Pill></div>
          <div className="muted small" style={{ marginTop: 2 }}>
            {st.ok ? `Granted by the Root Governance Authority on ${fmtDate(st.since)}. You can license Manufacturers.`
              : st.since ? 'The Root Governance Authority revoked your licence. Manufacturers you licensed are suspended.'
              : 'Your registration is on-chain. The Root Governance Authority must grant your LG licence before you can license Manufacturers.'}
          </div>
        </div>
      </div>
    )
  }

  const lic = st.lic
  const issuerRole = ISSUER_OF[s.role]
  if (!lic) {
    return (
      <div className="card licence wait">
        <div className="licence-icon">⏳</div>
        <div className="grow">
          <div className="row"><b>No licence yet</b><Pill tone="amber" dot>Waiting</Pill></div>
          <div className="muted small" style={{ marginTop: 2 }}>
            Ask a {ROLE_LABEL[issuerRole]} to issue your {s.role === 'Manufacturer' ? 'Manufacturing License' : 'Trade License'}. Share your wallet address <code>{short(s.address)}</code> with them.
          </div>
        </div>
      </div>
    )
  }
  const reason = {
    active: `Valid until ${fmtDate(lic.expiresAt)} (${daysLeft(lic.expiresAt)} days left).`,
    suspended: `Suspended because ${d.name(lic.issuer)}'s own licence is no longer valid. It reactivates automatically if theirs is restored.`,
    revoked: `Revoked by ${d.name(lic.issuer)}. Ask a ${ROLE_LABEL[issuerRole]} for a new licence.`,
    expired: `Expired on ${fmtDate(lic.expiresAt)}. Ask a ${ROLE_LABEL[issuerRole]} to renew it.`,
  }[lic.status]
  return (
    <div className={`card licence ${lic.status === 'active' ? 'ok' : 'bad'}`}>
      <div className="licence-icon">{lic.status === 'active' ? '🪪' : '⛔'}</div>
      <div className="grow">
        <div className="row"><b>{LICENSE_LABEL[lic.type] || lic.type}</b><CredPill status={lic.status} /></div>
        <div className="muted small" style={{ marginTop: 2 }}>{reason}</div>
      </div>
      <div className="kv">
        <div className="kv-item"><div className="kv-k">Issued by</div><div className="kv-v">{d.name(lic.issuer)}</div></div>
        <div className="kv-item"><div className="kv-k">Issued</div><div className="kv-v">{fmtDate(lic.issuedAt)}</div></div>
        <div className="kv-item"><div className="kv-k">Expires</div><div className="kv-v">{fmtDate(lic.expiresAt)}</div></div>
      </div>
    </div>
  )
}

/** Licensees of the signed-in wallet that are currently active (for "ship to" dropdowns). */
export function useActiveLicensees() {
  const s = useSession()
  return useLoad(async () => {
    const issued = await loadIssuedBy(s.address)
    const seen = new Set()
    return issued.filter(c => c.status === 'active' && !seen.has(c.holder.toLowerCase()) && seen.add(c.holder.toLowerCase()))
  }, [s.address])
}

/**
 * Issue / revoke licences to the next role down the chain.
 * LG → Manufacturers, Manufacturer → Distributors, Distributor → Retailers.
 */
export function LicencePanel({ standing, onChange }) {
  const s = useSession()
  const d = useDirectory()
  const { run, busy } = useTx()
  const cfg = LICENSES[s.role]
  const targetLabel = ROLE_LABEL[cfg.target]
  const [holder, setHolder] = useState('')
  const [days, setDays] = useState('365')

  const issued = useLoad(() => loadIssuedBy(s.address), [s.address])
  // licensedBy for every registered company of the target role
  const candidates = useLoad(async () => {
    const { cred } = reader()
    const list = d.byRole(cfg.target).filter(x => x.active)
    const by = await Promise.all(list.map(x => cred.licensedBy(x.address)))
    return list.map((x, i) => ({ ...x, licensedBy: isZero(by[i]) ? null : by[i] }))
  }, [d.dir, cfg.target, issued.data])

  const available = useMemo(() => (candidates.data || []).filter(c => !c.licensedBy), [candidates.data])
  const canIssue = standing.data?.ok

  async function issue(e) {
    e.preventDefault()
    const n = Number(days)
    if (!holder || !(n >= 1 && n <= 3650)) return
    const expires = BigInt(nowSec() + n * DAY)
    const company = d.name(holder)
    await run('issue', () => s.write.cred.issueCredential(holder, expires), {
      success: `${cfg.label} issued to ${company}.`,
      onDone: async () => { setHolder(''); await Promise.all([issued.reload(), candidates.reload()]); onChange?.() },
    })
  }

  async function revoke(c) {
    await run('revoke:' + c.id, () => s.write.cred.revokeCredential(c.id), {
      success: `Licence of ${d.name(c.holder)} revoked.`,
      onDone: async () => { await Promise.all([issued.reload(), candidates.reload()]); onChange?.() },
    })
  }

  const rows = issued.data || []
  const activeCount = rows.filter(r => r.status === 'active').length

  return (
    <div className="grid grid-aside">
      <Card title={`License a ${targetLabel}`} subtitle={`Issue a ${cfg.label}. Only registered ${targetLabel}s without a licence are listed.`}>
        {!canIssue && !standing.loading && (
          <div style={{ marginBottom: 14 }}>
            <Alert type="warning">You can issue licences once your own {s.role === 'LocalGovt' ? 'LG licence' : 'licence'} is active.</Alert>
          </div>
        )}
        <form className="form" onSubmit={issue}>
          <Field
            label={targetLabel}
            hint={candidates.loading ? 'Loading companies…' : available.length ? `${available.length} unlicensed ${targetLabel.toLowerCase()}${available.length === 1 ? '' : 's'}` : undefined}
          >
            <select className="select" value={holder} onChange={e => setHolder(e.target.value)} disabled={!canIssue || !available.length}>
              <option value="">{available.length ? `Select a ${targetLabel.toLowerCase()}…` : `No unlicensed ${targetLabel.toLowerCase()}s`}</option>
              {available.map(c => <option key={c.address} value={c.address}>{c.company} — {short(c.address)}</option>)}
            </select>
          </Field>
          {holder && <div className="copy-box">{holder}</div>}
          <Field label="Valid for (days)" hint={`Expires ${fmtDate(nowSec() + Number(days || 0) * DAY)}`}>
            <input className="input" type="number" min="1" max="3650" value={days} onChange={e => setDays(e.target.value)} disabled={!canIssue} />
          </Field>
          <Button type="submit" block loading={busy === 'issue'} disabled={!canIssue || !holder || !(Number(days) >= 1)}>
            🪪 Issue {cfg.label}
          </Button>
        </form>

        {(candidates.data || []).some(c => c.licensedBy && !sameAddr(c.licensedBy, s.address)) && (
          <div style={{ marginTop: 18 }}>
            <div className="field-label" style={{ marginBottom: 8 }}>Licensed by someone else</div>
            <div className="stack" style={{ gap: 8 }}>
              {candidates.data.filter(c => c.licensedBy && !sameAddr(c.licensedBy, s.address)).map(c => (
                <div key={c.address} className="row-between small">
                  <Entity address={c.address} name={c.company} role={c.role} size={28} />
                  <span className="faint">by {d.name(c.licensedBy)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card
        title={`${targetLabel}s you licensed`}
        subtitle={`${activeCount} active · ${rows.length} total`}
        bodyClass="tight"
        actions={<Button variant="ghost" size="sm" onClick={() => { issued.reload(); candidates.reload() }}>↻ Refresh</Button>}
      >
        {issued.loading ? <Loading /> : issued.error ? <div className="card-body"><Alert type="error">{issued.error}</Alert></div>
          : !rows.length ? <Empty icon="🪪" title="No licences issued yet">Licences you issue will appear here.</Empty>
          : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Company</th><th>Licence</th><th>Issued</th><th>Expires</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map(c => {
                    const who = d.get(c.holder)
                    return (
                      <tr key={c.id}>
                        <td><Entity address={c.holder} name={who?.company} role={who?.role} /></td>
                        <td className="nowrap">{LICENSE_LABEL[c.type] || c.type}</td>
                        <td className="nowrap">{fmtDate(c.issuedAt)}</td>
                        <td className="nowrap">{fmtDate(c.expiresAt)}</td>
                        <td><CredPill status={c.status} /></td>
                        <td style={{ textAlign: 'right' }}>
                          {!c.revoked && (
                            <Button variant="danger" size="sm" loading={busy === 'revoke:' + c.id} disabled={!!busy} onClick={() => revoke(c)}>Revoke</Button>
                          )}
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
  )
}
