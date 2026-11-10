// Step-by-step guidance per role. Used by the welcome pop-up, the dashboard
// "Getting started" sidebar, the Register page and the public How-it-works page.
//
// Each step: title, do (what you click), happens (what the blockchain does),
// tab (dashboard tab that the "Go" button opens), done(facts) → bool.

export const ROLE_GUIDE = {
  RootGA: {
    intro: 'You are the root of trust. Every licence in the system traces back to a Local Government licence that you grant.',
    steps: [
      { id: 'lg', title: 'Grant a Local Government licence', tab: 'lg',
        do: 'Open “Local Governments”, find a company registered as Local Government and click “Grant LG licence”.',
        happens: 'TrustRegistry.authorizeIssuer marks the LG as trusted. From now on it can license Manufacturers.',
        done: f => f.lgLicensed > 0 },
      { id: 'monitor', title: 'Watch the network', tab: 'audit',
        do: 'Use the Audit trail tab and the public Trust map to see every licence and product event.',
        happens: 'Every action is written to the AuditLog contract and can never be edited.',
        done: f => f.lgLicensed > 0 && f.products > 0 },
      { id: 'revoke', title: 'Revoke when needed', tab: 'lg', optional: true,
        do: 'Click “Revoke licence” next to an LG.',
        happens: 'Cascading revocation: that LG’s Manufacturers, their Distributors and Retailers are suspended instantly. Re-granting restores them.',
        done: () => false },
    ],
  },

  LocalGovt: {
    intro: 'You license Manufacturers in your jurisdiction. You need the Root Governance Authority to approve you first.',
    steps: [
      { id: 'did', title: 'Register your company (DID)', do: 'Done when you registered with the Local Government role.',
        happens: 'DIDRegistry stored did:besu:<your wallet>, your role and your unique company name.', done: () => true },
      { id: 'root', title: 'Get approved by the Root Authority', tab: 'mf',
        do: 'Nothing to click — tell the Root Governance Authority your company name. Your banner turns green when approved.',
        happens: 'rootGA calls TrustRegistry.authorizeIssuer(your wallet).', done: f => f.licensed },
      { id: 'issue', title: 'License a Manufacturer', tab: 'mf',
        do: 'Open “Manufacturers”, pick a registered Manufacturer, choose how many days the licence is valid and click “Issue”.',
        happens: 'CredentialRegistry stores a ManufacturingLicense credential (issuer = you, holder = them, expiry).', done: f => f.issued > 0 },
      { id: 'watch', title: 'Monitor and revoke', tab: 'mf', optional: true,
        do: 'Revoke a Manufacturer’s licence from the same table if it breaks the rules.',
        happens: 'Its products freeze, and its Distributors/Retailers are suspended (cascading revocation).', done: () => false },
    ],
  },

  Manufacturer: {
    intro: 'You create products and license the Distributors that carry them. Products only move to Distributors you licensed.',
    steps: [
      { id: 'did', title: 'Register your company (DID)', do: 'Done when you registered as Manufacturer.',
        happens: 'DIDRegistry stored your DID, role and unique company name on-chain.', done: () => true },
      { id: 'lic', title: 'Get a Manufacturing License', tab: 'products',
        do: 'Ask a licensed Local Government to issue you a Manufacturing License. Your banner turns green when it is active.',
        happens: 'The LG calls CredentialRegistry.issueCredential(your wallet, expiry).', done: f => f.licensed },
      { id: 'partner', title: 'License a Distributor', tab: 'partners',
        do: 'Open “Distributors”, pick a registered Distributor and issue a Trade License. A Distributor may also work for other Manufacturers.',
        happens: 'A TradeLicense credential links you → that Distributor. You can only ship to Distributors you licensed.', done: f => f.partners > 0 },
      { id: 'create', title: 'Create a product', tab: 'products',
        do: 'Fill in name, quantity, batch number and description (all required) and click “Create product”. Made a mistake? Delete it while it is still in your stock.',
        happens: 'ProductTransfer mints an ERC-721 token in your name with status “In stock”.', done: f => f.products > 0 },
      { id: 'ship', title: 'Ship it to a Distributor', tab: 'products',
        do: 'Under the product choose a Distributor and click “Ship →”. You can cancel until they accept.',
        happens: 'Status becomes “In transit”. Custody only moves when the Distributor accepts (two-step handoff).', done: f => f.shipped },
      { id: 'track', title: 'Track it to the store', tab: 'products',
        do: 'Watch the status change. Use History / QR on any product. Handle returns from Distributors in the “Returns” tab.',
        happens: 'Once a Retailer accepts it, the product is “Delivered” and its public QR page shows a verified chain.', done: f => f.delivered },
    ],
  },

  Distributor: {
    intro: 'You receive products from the Manufacturers that licensed you and ship them to Retailers you license. You can work for several Manufacturers — each one is kept in its own box.',
    steps: [
      { id: 'did', title: 'Register your company (DID)', do: 'Done when you registered as Distributor.',
        happens: 'DIDRegistry stored your DID, role and unique company name on-chain.', done: () => true },
      { id: 'lic', title: 'Get a Trade License from a Manufacturer', tab: 'incoming',
        do: 'Ask each Manufacturer you work with to issue you a Trade License (one per Manufacturer).',
        happens: 'CredentialRegistry links Manufacturer → you. You can only handle that Manufacturer’s products while its licence is active.', done: f => f.licensed },
      { id: 'partner', title: 'License a Retailer', tab: 'partners',
        do: 'Open “Retailers”, pick a registered Retailer and issue a Trade License.',
        happens: 'A TradeLicense credential links you → that Retailer. You can only ship to Retailers you licensed.', done: f => f.partners > 0 },
      { id: 'accept', title: 'Accept your first shipment', tab: 'incoming',
        do: 'Open “Incoming” and click “Accept shipment”. Shipments are grouped by Manufacturer.',
        happens: 'confirmReceipt moves the token to you. It reverts if your licence from that Manufacturer is no longer active.', done: f => f.received },
      { id: 'ship', title: 'Ship to a Retailer — or return', tab: 'inventory',
        do: 'In “Inventory” choose a Retailer and click “Ship →”, or “↩ Return” to send a product back to its Manufacturer with a reason.',
        happens: 'Status becomes “In transit” until the Retailer (or Manufacturer, for a return) accepts.', done: f => f.shipped },
    ],
  },

  Retailer: {
    intro: 'You receive products from the Distributors that licensed you and prove to customers that they are authentic.',
    steps: [
      { id: 'did', title: 'Register your company (DID)', do: 'Done when you registered as Retailer.',
        happens: 'DIDRegistry stored your DID, role and unique company name on-chain.', done: () => true },
      { id: 'lic', title: 'Get a Trade License from a Distributor', tab: 'incoming',
        do: 'Ask each Distributor you buy from to issue you a Trade License.',
        happens: 'CredentialRegistry links Distributor → you. Only Distributors that licensed you can ship to you.', done: f => f.licensed },
      { id: 'accept', title: 'Accept a shipment', tab: 'incoming',
        do: 'Open “Incoming” and click “Accept shipment”. Shipments are grouped by Distributor.',
        happens: 'The product becomes “Delivered” and the token moves to you.', done: f => f.received },
      { id: 'verify', title: 'Verify and share the QR code', tab: 'inventory',
        do: 'In “In store” click “Verify chain”, then “QR” to print the code for customers. Use “↩ Return” to send a faulty product back.',
        happens: 'TraceabilityAudit checks MF → DT → RT and that every handoff was licensed at the time. Anyone can scan the QR — no wallet needed.', done: f => f.verified },
    ],
  },
}

/** Steps with done flags, plus the index of the next open step. */
export function progress(role, facts) {
  const g = ROLE_GUIDE[role]
  if (!g) return { steps: [], next: -1, done: 0, total: 0 }
  const steps = g.steps.map(s => ({ ...s, isDone: !!s.done(facts || {}) }))
  const required = steps.filter(s => !s.optional)
  return {
    steps,
    next: steps.findIndex(s => !s.isDone && !s.optional),
    done: required.filter(s => s.isDone).length,
    total: required.length,
  }
}

/** Lifecycle of a product — used on the public Guide page. */
export const LIFECYCLE = [
  ['🏭', 'Created', 'A licensed Manufacturer mints the product (name, quantity, batch, description are required). It can be deleted only while it never left the Manufacturer.'],
  ['🚚', 'Shipped → accepted', 'The Manufacturer ships to a Distributor it licensed. Custody moves only when the Distributor accepts. Same again from Distributor to a Retailer it licensed.'],
  ['🏪', 'Delivered', 'When a Retailer accepts, the product is Delivered. The public page shows the verified chain Manufacturer → Distributor → Retailer.'],
  ['↩', 'Returned', 'A Retailer can send a product back to its Distributor, and a Distributor back to its Manufacturer — always with a reason that is stored on-chain.'],
  ['⤺', 'Recalled / called back', 'A Manufacturer can recall its product from anyone downstream. If a licence is revoked or expires, an in-transit shipment reverts to the sender and a held product can be called back upstream — with a note saying which licence lapsed.'],
]
