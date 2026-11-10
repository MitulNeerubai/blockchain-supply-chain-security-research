import { loadProducts, reader } from '../lib/chain'
import { useDirectory, useLoad, useNetwork } from '../lib/app'
import { LICENSE_LABEL, ROLE_ICON, ROLE_LABEL, fmtDate, sameAddr } from '../lib/format'
import { Alert, CompanyLink, CopyButton, CredPill, Empty, Entity, Loading, Modal, Pill, RoleBadge, StatusDot } from './ui'
import { StatusPill } from './Products'

const CHILD_ROLE = { LocalGovt: 'Manufacturer', Manufacturer: 'Distributor', Distributor: 'Retailer' }

/** Whole trust hierarchy: Root → LGs → Manufacturers → Distributors → Retailers. */
export function TrustTree({ highlight, showUnlicensed = true }) {
  const d = useDirectory()
  const net = useNetwork()
  if (!net.ready || d.loading) return <Loading>Reading the trust network…</Loading>
  if (net.error) return <Alert type="error">{net.error}</Alert>

  const lgs = d.byRole('LocalGovt')
  const childrenOf = addr => net.issued(addr)
    .filter(c => d.get(c.holder)?.role === CHILD_ROLE[d.get(addr)?.role])
    .sort((a, b) => (b.active - a.active) || a.issuedAt - b.issuedAt)

  const node = (addr, edge, depth, path) => {
    const who = d.get(addr)
    const kids = depth < 4 && !path.includes(addr.toLowerCase()) ? childrenOf(addr) : []
    const multi = who?.role === 'Distributor' || who?.role === 'Retailer' ? net.held(addr).filter(c => c.active).length : 0
    return (
      <li key={addr + (edge?.id || '')} className={sameAddr(addr, highlight) ? 'me' : ''}>
        <div className="tree-row">
          <Entity address={addr} name={who?.company} role={who?.role} size={26} sub={ROLE_LABEL[who?.role]} />
          {edge?.lgState && <span className="tree-edge"><Pill tone={{ active: 'green', revoked: 'red', pending: 'amber' }[edge.lgState]} dot>{{ active: 'Licensed by Root', revoked: 'Revoked by Root', pending: 'Awaiting Root' }[edge.lgState]}</Pill></span>}
          {edge && !edge.lgState && <span className="tree-edge"><CredPill status={edge.status} /><span className="faint small">until {fmtDate(edge.expiresAt)}</span></span>}
          {multi > 1 && <span className="faint small">works with {multi} {who.role === 'Distributor' ? 'manufacturers' : 'distributors'}</span>}
          {sameAddr(addr, highlight) && <Pill tone="blue">You</Pill>}
        </div>
        {kids.length > 0 && <ul>{kids.map(c => node(c.holder, c, depth + 1, [...path, addr.toLowerCase()]))}</ul>}
      </li>
    )
  }

  const unlicensed = [...d.dir.values()].filter(x => x.role !== 'LocalGovt' && !net.held(x.address).length)
  return (
    <div className="tree">
      <ul>
        <li className={sameAddr(net.rootGA, highlight) ? 'me' : ''}>
          <div className="tree-row">
            <Entity address={net.rootGA} name="Root Governance Authority" role="RootGA" size={26} sub="Root of trust" />
            {sameAddr(net.rootGA, highlight) && <Pill tone="blue">You</Pill>}
          </div>
          {lgs.length ? (
            <ul>
              {lgs.map(lg => {
                const st = net.lg[lg.address.toLowerCase()]
                return node(lg.address, { id: 'lg', lgState: st?.authorized ? 'active' : st?.since ? 'revoked' : 'pending' }, 1, [])
              })}
            </ul>
          ) : <div className="faint small" style={{ padding: '6px 0 0 34px' }}>No Local Governments registered yet.</div>}
        </li>
      </ul>
      {showUnlicensed && unlicensed.length > 0 && (
        <div className="tree-unlicensed">
          <div className="field-label">Registered, waiting for a licence</div>
          <div className="row" style={{ gap: 14, marginTop: 8 }}>
            {unlicensed.map(x => <Entity key={x.address} address={x.address} name={x.company} role={x.role} size={24} sub={ROLE_LABEL[x.role]} />)}
          </div>
        </div>
      )}
    </div>
  )
}

/** Chains of licences from a company up to the Root (one per issuer). */
export function trustPaths(net, d, addr, depth = 0) {
  if (!addr || depth > 5) return [[]]
  if (net.isRoot(addr)) return [[{ addr, label: 'Root Governance Authority' }]]
  const who = d.get(addr)
  if (who?.role === 'LocalGovt') {
    const st = net.lg[addr.toLowerCase()]
    return [[{ addr, status: st?.authorized ? 'active' : st?.since ? 'revoked' : 'pending' }, { addr: net.rootGA, label: 'Root Governance Authority' }]]
  }
  const held = net.held(addr)
  if (!held.length) return [[{ addr, status: 'pending' }]]
  return held.flatMap(c => trustPaths(net, d, c.issuer, depth + 1).map(up => [{ addr, status: c.status, cred: c }, ...up]))
}

export function TrustPath({ address }) {
  const d = useDirectory()
  const net = useNetwork()
  if (!net.ready) return <Loading />
  const paths = trustPaths(net, d, address)
  return (
    <div className="stack" style={{ gap: 10 }}>
      {paths.map((p, i) => (
        <div className="trust-path" key={i}>
          {p.map((n, j) => (
            <span key={j} className="tp-node">
              {j > 0 && <span className="tp-arrow">←</span>}
              <span className="tp-chip">
                <span>{ROLE_ICON[d.get(n.addr)?.role || (net.isRoot(n.addr) ? 'RootGA' : '')] || '•'}</span>
                <CompanyLink address={n.addr}>{n.label || d.name(n.addr)}</CompanyLink>
                {n.status && <StatusDot state={n.status} title={n.status} />}
              </span>
            </span>
          ))}
        </div>
      ))}
      <div className="faint small">Read right-to-left: each company was licensed by the one to its right. A break anywhere suspends everything to its left.</div>
    </div>
  )
}

/** Company profile: identity, trust path, licences held / issued, products. */
export function ProfileModal({ address, onClose }) {
  const d = useDirectory()
  const net = useNetwork()
  const isRoot = net.isRoot(address)
  const who = d.get(address)
  const role = isRoot ? 'RootGA' : who?.role
  const st = net.statusOf(address)

  const products = useLoad(async () => {
    if (!role || role === 'RootGA' || role === 'LocalGovt') return []
    const { pt } = reader()
    const ids = role === 'Manufacturer' ? await pt.getManufacturerProducts(address) : await pt.getHolderProducts(address)
    const list = await loadProducts(ids)
    return role === 'Manufacturer' ? list : list.filter(p => sameAddr(p.holder, address) || sameAddr(p.pending, address))
  }, [address, role])

  const held = net.held(address)
  const issued = net.issued(address)
  return (
    <Modal title="Company profile" onClose={onClose} width={720}>
      {!who && !isRoot ? <Alert type="warning">This address has not registered a company.</Alert> : (
        <div className="stack">
          <div className="row-between">
            <Entity address={address} name={isRoot ? 'Root Governance Authority' : who.company} role={role} size={44} noLink />
            <div className="row" style={{ gap: 8 }}><RoleBadge role={role} /><Pill tone={{ active: 'green', pending: 'amber', suspended: 'amber' }[st.state] || 'red'} dot>{st.label}</Pill></div>
          </div>
          {who && (
            <div className="kv">
              <div className="kv-item"><div className="kv-k">DID</div><div className="kv-v mono small">{who.did} <CopyButton text={who.did} /></div></div>
              <div className="kv-item"><div className="kv-k">Registered</div><div className="kv-v">{fmtDate(who.createdAt)}</div></div>
            </div>
          )}

          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>Trust path</div>
            <TrustPath address={address} />
          </div>

          {!isRoot && role !== 'LocalGovt' && (
            <div>
              <div className="field-label" style={{ marginBottom: 8 }}>Licences held</div>
              {!held.length ? <p className="faint small">No licence yet.</p> : (
                <div className="table-wrap"><table className="table compact"><thead><tr><th>From</th><th>Type</th><th>Expires</th><th>Status</th></tr></thead><tbody>
                  {held.map(c => <tr key={c.id}><td><CompanyLink address={c.issuer}>{d.name(c.issuer)}</CompanyLink></td><td>{LICENSE_LABEL[c.type]}</td><td className="nowrap">{fmtDate(c.expiresAt)}</td><td><CredPill status={c.status} /></td></tr>)}
                </tbody></table></div>
              )}
            </div>
          )}

          {(role === 'LocalGovt' || role === 'Manufacturer' || role === 'Distributor') && (
            <div>
              <div className="field-label" style={{ marginBottom: 8 }}>Licences issued ({issued.filter(c => c.active).length} active)</div>
              {!issued.length ? <p className="faint small">None issued yet.</p> : (
                <div className="table-wrap"><table className="table compact"><thead><tr><th>To</th><th>Expires</th><th>Status</th></tr></thead><tbody>
                  {issued.map(c => <tr key={c.id}><td><CompanyLink address={c.holder}>{d.name(c.holder)}</CompanyLink></td><td className="nowrap">{fmtDate(c.expiresAt)}</td><td><CredPill status={c.status} /></td></tr>)}
                </tbody></table></div>
              )}
            </div>
          )}

          {role && role !== 'RootGA' && role !== 'LocalGovt' && (
            <div>
              <div className="field-label" style={{ marginBottom: 8 }}>{role === 'Manufacturer' ? 'Products created' : 'Products held now'}</div>
              {products.loading ? <Loading /> : !products.data?.length ? <Empty icon="📦" title="No products" /> : (
                <div className="table-wrap"><table className="table compact"><thead><tr><th>#</th><th>Product</th><th>Status</th></tr></thead><tbody>
                  {products.data.slice(0, 15).map(p => <tr key={p.id}><td className="pid">{p.id}</td><td><a href={`#/product/${p.id}`} onClick={onClose}>{p.name}</a></td><td><StatusPill status={p.status} /></td></tr>)}
                </tbody></table></div>
              )}
              {products.data?.length > 15 && <p className="faint small" style={{ marginTop: 6 }}>Showing 15 of {products.data.length}. See all on the Products page.</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
