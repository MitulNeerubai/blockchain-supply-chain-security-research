import { useState } from 'react'
import { useNetwork, useSession } from '../lib/app'
import { Card, Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { LicenceBanner, LicencePanel, useStanding } from '../components/Licences'
import { ProductLookup } from '../components/Products'
import { EmailSettings } from '../components/EmailSettings'
import { TrustTree } from '../components/Network'
import DashFrame from '../components/DashFrame'

export default function LocalGovt() {
  const s = useSession()
  const net = useNetwork()
  const standing = useStanding()
  const [tab, setTab] = useState('mf')
  const facts = { loading: standing.loading, licensed: !!standing.data?.ok, issued: net.issued(s.address).length }
  return (
    <DashFrame facts={facts} onGo={setTab}>
      <PageHead session={s} title={s.company} />
      <div style={{ marginBottom: 20 }}><LicenceBanner standing={standing} /></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'mf', label: 'Manufacturers', icon: '🏭' },
        { id: 'tree', label: 'Trust map', icon: '🌳' },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'email', label: 'Notifications', icon: '📧' },
      ]} />
      {tab === 'mf' && <LicencePanel standing={standing} />}
      {tab === 'tree' && <Card title="Trust hierarchy" subtitle="Everyone whose licence depends on yours is highlighted under your name."><TrustTree highlight={s.address} /></Card>}
      {tab === 'lookup' && <ProductLookup />}
      {tab === 'email' && <EmailSettings address={s.address} signer={s.signer} />}
    </DashFrame>
  )
}
