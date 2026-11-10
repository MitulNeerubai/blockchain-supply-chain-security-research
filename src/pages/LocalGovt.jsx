import { useState } from 'react'
import { useSession } from '../lib/app'
import { Tabs } from '../components/ui'
import { PageHead } from '../components/Layout'
import { LicenceBanner, LicencePanel, useStanding } from '../components/Licences'
import { ProductLookup } from '../components/Products'
import { EmailSettings } from '../components/EmailSettings'

export default function LocalGovt() {
  const s = useSession()
  const standing = useStanding()
  const [tab, setTab] = useState('mf')
  return (
    <div className="page">
      <PageHead session={s} title={s.company} />
      <div style={{ marginBottom: 20 }}><LicenceBanner standing={standing} /></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'mf', label: 'Manufacturers', icon: '🏭' },
        { id: 'lookup', label: 'Product lookup', icon: '🔍' },
        { id: 'email', label: 'Notifications', icon: '📧' },
      ]} />
      {tab === 'mf' && <LicencePanel standing={standing} />}
      {tab === 'lookup' && <ProductLookup />}
      {tab === 'email' && <EmailSettings address={s.address} signer={s.signer} />}
    </div>
  )
}
