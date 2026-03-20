import * as StellarSdk from '@stellar/stellar-sdk'
import { isConnected, requestAccess, signTransaction } from '@stellar/freighter-api'

const CONTRACT_ID = (import.meta.env.VITE_CONTRACT_ID       || '').trim()
const XLM_TOKEN   = (import.meta.env.VITE_XLM_TOKEN         || '').trim()
const NET         = (import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015').trim()
const RPC_URL     = (import.meta.env.VITE_SOROBAN_RPC_URL   || 'https://soroban-testnet.stellar.org').trim()
const DUMMY       = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'

export const rpc = new StellarSdk.rpc.Server(RPC_URL)

export async function connectWallet() {
  const { isConnected: connected } = await isConnected()
  if (!connected) throw new Error('Freighter not installed.')
  const { address, error } = await requestAccess()
  if (error) throw new Error(error)
  return address
}

async function sendTx(publicKey, op) {
  const account = await rpc.getAccount(publicKey)
  const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase: NET })
    .addOperation(op).setTimeout(60).build()
  const sim = await rpc.simulateTransaction(tx)
  if (StellarSdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build()
  const result = await signTransaction(prepared.toXDR(), { networkPassphrase: NET })
  if (result.error) throw new Error(result.error)
  const signed = StellarSdk.TransactionBuilder.fromXDR(result.signedTxXdr, NET)
  const sent = await rpc.sendTransaction(signed)
  for (let i = 0; i < 30; i++) {
    const r = await rpc.getTransaction(sent.hash)
    if (r.status === 'SUCCESS') return sent.hash
    if (r.status === 'FAILED')  throw new Error('Transaction failed')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Timed out')
}

async function readContract(op) {
  const dummy = new StellarSdk.Account(DUMMY, '0')
  const tx = new StellarSdk.TransactionBuilder(dummy, { fee: StellarSdk.BASE_FEE, networkPassphrase: NET })
    .addOperation(op).setTimeout(30).build()
  const sim = await rpc.simulateTransaction(tx)
  return StellarSdk.scValToNative(sim.result.retval)
}

async function approveXlm(pk, stroops) {
  return sendTx(pk, new StellarSdk.Contract(XLM_TOKEN).call(
    'approve',
    StellarSdk.Address.fromString(pk).toScVal(),
    StellarSdk.Address.fromString(CONTRACT_ID).toScVal(),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.xdr.ScVal.scvU32(3_110_400),
  ))
}

const tc = () => new StellarSdk.Contract(CONTRACT_ID)

export async function createWill(owner, beneficiary, title, note, amountXlm, intervalLedgers) {
  const stroops = Math.ceil(amountXlm * 10_000_000)
  await approveXlm(owner, stroops)
  return sendTx(owner, tc().call(
    'create_will',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.Address.fromString(beneficiary).toScVal(),
    StellarSdk.xdr.ScVal.scvString(title),
    StellarSdk.xdr.ScVal.scvString(note),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.xdr.ScVal.scvU32(intervalLedgers),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function pingWill(owner, willId) {
  return sendTx(owner, tc().call(
    'ping',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(willId))),
  ))
}

export async function topUpWill(owner, willId, amountXlm) {
  const stroops = Math.ceil(amountXlm * 10_000_000)
  await approveXlm(owner, stroops)
  return sendTx(owner, tc().call(
    'top_up',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(willId))),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function revokeWill(owner, willId) {
  return sendTx(owner, tc().call(
    'revoke',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(willId))),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function claimWill(beneficiary, willId) {
  return sendTx(beneficiary, tc().call(
    'claim',
    StellarSdk.Address.fromString(beneficiary).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(willId))),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function getWill(id) {
  try {
    return await readContract(tc().call('get_will',
      StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(id)))))
  } catch { return null }
}

export async function getOwnerWills(addr) {
  try {
    const ids = await readContract(tc().call('get_owner_wills',
      StellarSdk.Address.fromString(addr).toScVal()))
    return Array.isArray(ids) ? ids.map(Number).reverse() : []
  } catch { return [] }
}

export async function getBeneficiaryWills(addr) {
  try {
    const ids = await readContract(tc().call('get_beneficiary_wills',
      StellarSdk.Address.fromString(addr).toScVal()))
    return Array.isArray(ids) ? ids.map(Number).reverse() : []
  } catch { return [] }
}

export async function getTimeUntilClaimable(willId) {
  try {
    return Number(await readContract(tc().call('time_until_claimable',
      StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(willId))))))
  } catch { return 0 }
}

export async function getWillCount() {
  try { return Number(await readContract(tc().call('count'))) }
  catch { return 0 }
}

export const xlm   = s => (Number(s) / 10_000_000).toFixed(2)
export const short = a => a ? `${a.toString().slice(0,5)}…${a.toString().slice(-4)}` : '—'
export function ledgersToTime(l) {
  const s = l * 5
  if (s <= 0)      return 'Overdue'
  if (s < 3600)    return `${Math.floor(s/60)}m`
  if (s < 86400)   return `${Math.floor(s/3600)}h`
  if (s < 86400*7) return `${Math.floor(s/86400)}d ${Math.floor((s%86400)/3600)}h`
  return `${Math.floor(s/86400)}d`
}
export { CONTRACT_ID }
