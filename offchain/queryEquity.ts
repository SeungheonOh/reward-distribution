import * as L from "@lucid-evolution/lucid";
import { Lucid, Maestro } from "@lucid-evolution/lucid";
import { load } from 'ts-dotenv';

const {WALLET_SEED, EQUITY_REF_HASH, EQUITY_REF_IDX } = load({WALLET_SEED: String, EQUITY_REF_HASH:String, EQUITY_REF_IDX: Number});

const network = "Preview"
const lucid = await Lucid(
  new Maestro({
    network: network,
    apiKey: "2h7fgnqEH13ecpQjIH1QJsE0DSAzyfrw",
    turboSubmit: false,
  }),
  network
)

lucid.selectWallet.fromSeed(WALLET_SEED)
const uniqRef = (await lucid.wallet().getUtxos())[0]

const equityNftScriptORef = {txHash: EQUITY_REF_HASH, outputIndex: EQUITY_REF_IDX}
const [equityNftRefUtxo] = await lucid.utxosByOutRef([equityNftScriptORef])

const equityNft = equityNftRefUtxo.scriptRef
const equityNftSymbol = L.mintingPolicyToId(equityNft)

const utxos = await lucid.wallet().getUtxos()

const equityHoldings = utxos.map(x => {
  return Object.fromEntries(Object.entries(x.assets).filter(([k, v]) => k.slice(0, 56) == equityNftSymbol))
}).flatMap(Object.entries).reduce((acc, [k, v]) => ({
  ...acc,
  [k]: (acc[k] || 0n) + v
}), {})

console.log(equityHoldings)

Object.entries(equityHoldings).forEach(([asset, amount]) => {
  let period = parseInt(asset.slice(56), 16)
  console.log(`${period}: ${amount}`)
})
