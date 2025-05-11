import * as L from "@lucid-evolution/lucid";
import { Lucid, Maestro } from "@lucid-evolution/lucid";
import { load } from 'ts-dotenv';

const walletSeed = load({WALLET_SEED: String}).WALLET_SEED;

const network = "Preview"
const lucid = await Lucid(
  new Maestro({
    network: network,
    apiKey: "2h7fgnqEH13ecpQjIH1QJsE0DSAzyfrw",
    turboSubmit: false,
  }),
  network
)

lucid.selectWallet.fromSeed(walletSeed)
const uniqRef = (await lucid.wallet().getUtxos())[0]

const equityNftScriptORef = {
  txHash: "c6bf14dce07abadc1679e53769df75b3288194224ce963895e72815e20f90e35",
  outputIndex: 0,
}

const [equityNftRefUtxo] = await lucid.utxosByOutRef([equityNftScriptORef])

const equityNft = equityNftRefUtxo.scriptRef
const equityNftSymbol = L.mintingPolicyToId(equityNft)

const tx =
  await lucid.newTx()
    .readFrom([equityNftRefUtxo])
    .mintAssets({
      [equityNftSymbol+"00"]: -1000n,
      [equityNftSymbol+"01"]: 1000n
    }, L.Data.to(new L.Constr(0, [])))
    .attach.MintingPolicy(equityNft)
    .complete()

const signed = await tx.sign.withWallet().complete()
const hash = await signed.submit()

console.log(hash)

await lucid.awaitTx(hash, 40_000)

console.log("submission confirmed")
console.log(`Equity currency symbol ${equityNftSymbol}`)
