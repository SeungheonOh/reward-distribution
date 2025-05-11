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

const tx =
  await lucid.newTx()
    .readFrom([equityNftRefUtxo])
    .mintAssets({
      [equityNftSymbol+"00"]: -5000n,
      [equityNftSymbol+"01"]: 5000n
    }, L.Data.to(new L.Constr(0, [])))
    .attach.MintingPolicy(equityNft)
    .complete()

const signed = await tx.sign.withWallet().complete()
const hash = await signed.submit()

console.log(hash)

await lucid.awaitTx(hash, 40_000)

console.log("submission confirmed")
console.log(`Equity currency symbol ${equityNftSymbol}`)
