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

const equityNftScriptORef = {txHash: EQUITY_REF_HASH, outputIndex: EQUITY_REF_IDX}
const [equityNftRefUtxo] = await lucid.utxosByOutRef([equityNftScriptORef])
const equityNft = equityNftRefUtxo.scriptRef
const equityNftSymbol = L.mintingPolicyToId(equityNft)

const poolScriptORef = {txHash: "ba39ecbb625628fd0352bcc9723cd2bee0cd61a8308b276e884132a564e58066", outputIndex: 0}
const [poolScriptUtxo] = await lucid.utxosByOutRef([poolScriptORef])
const poolScript = poolScriptUtxo.scriptRef
const poolNftSymbol = L.mintingPolicyToId(poolScript)
const poolAddress = L.validatorToAddress(lucid.config().network, poolScript)

const poolUtxos = await lucid.utxosAt(poolAddress)
const [poolUtxo] = poolUtxos.filter(x => Object.entries(x.assets).some(([unit, _]) => unit.slice(0, 56) == poolNftSymbol))

const poolIdx = (Object.entries(poolUtxo.assets).find(([unit, _]) => unit.slice(0, 56) == poolNftSymbol)[0]).slice(56)

console.log(poolUtxo)
console.log(`0x${poolIdx}`)

const withdrawAmount = 2000n

const tx =
  await lucid.newTx()
    .readFrom([equityNftRefUtxo, poolScriptUtxo])
    .collectFrom([poolUtxo], L.Data.to(new L.Constr(0, [])))
    .pay.ToContract(poolAddress, {kind: "inline", value: L.Data.to([])}, {
      lovelace: poolUtxo.assets.lovelace - withdrawAmount,
      [poolNftSymbol+poolIdx]: 1n,
    }, undefined)
    .mintAssets({
      [equityNftSymbol+"01"]: -withdrawAmount,
      [equityNftSymbol+"02"]: withdrawAmount
    }, L.Data.to(new L.Constr(0, [])))
    .complete()

const signed = await tx.sign.withWallet().complete()
const hash = await signed.submit()

console.log(hash)

await lucid.awaitTx(hash, 40_000)

console.log("submission confirmed")
