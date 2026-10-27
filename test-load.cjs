const { ethers } = require('ethers')
const ADDR = {
  pt:   '0xd1Fd5EBB6BCb93D99147575556c9AC29Ee4aEB7a',
  did:  '0x33C4D5Cb2048F8B3F0D6F1a64AdcAd458623635B',
  cred: '0x6Bb3A71C6408fCA66645278A1F1872B87f8EB54c',
}
const ABI = {
  pt:   ['event ProductCreated(uint256 indexed id, address indexed creator, string name)'],
  did:  ['event DIDRegistered(address indexed controller, string did, string role)'],
  cred: ['function isCredentialValid(address) view returns (bool)'],
}
async function main() {
  const MF = process.argv[2]
  if (!MF) { console.log('Usage: node test-load.cjs <MF_address>'); process.exit(1) }
  const provider = new ethers.JsonRpcProvider('https://eth.didlab.org')
  console.log('1. getBlockNumber...')
  const latest = await provider.getBlockNumber()
  console.log('   block:', latest)
  const from = Math.max(0, latest - 2000)
  console.log('2. ProductCreated scan...')
  const ptC = new ethers.Contract(ADDR.pt, ABI.pt, provider)
  for (let s = from; s <= latest; s += 500) {
    const e = Math.min(s + 499, latest)
    console.log(`   chunk ${s}-${e}`)
    const l = await ptC.queryFilter(ptC.filters.ProductCreated(null, MF), s, e)
    console.log(`   got ${l.length} logs`)
  }
  console.log('3. DIDRegistered scan...')
  const didC = new ethers.Contract(ADDR.did, ABI.did, provider)
  for (let s = from; s <= latest; s += 500) {
    const e = Math.min(s + 499, latest)
    const l = await didC.queryFilter(didC.filters.DIDRegistered(), s, e)
    console.log(`   chunk ${s}-${e}: ${l.length} logs`)
  }
  console.log('4. isCredentialValid...')
  const credC = new ethers.Contract(ADDR.cred, ABI.cred, provider)
  const valid = await credC.isCredentialValid(MF)
  console.log('   valid:', valid)
  console.log('ALL DONE')
}
main().catch(e => console.error('FAILED:', e.message))
