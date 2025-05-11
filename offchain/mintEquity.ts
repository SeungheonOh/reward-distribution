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

const equityScript = utxo => {
  return {
    type: "PlutusV3",
    script: L.applyParamsToScript(
      "5901b801010032323232323232232232253330063232323232533300b3370e900018061baa00113232533300d3232330010013758600460226ea8020894ccc04c004528099299980899baf300430133754602c00466e95200033015375201e6602a6ea00352f5c029444cc00c00c004c0580048c04c004528899191919299980a180b80109919299980999b8833794944dd7180a00199bca4a26eb8c05001454ccc04ccdc380119b81480000044cdc424000004294054ccc04ccdc380099b81480000084cdc4240000022940dd6980a0011bad30130031630150013015002301300132533300e3370e900118079baa00114bd6f7b63009bab30133010375400264660020026eacc04cc050c050c050c050c040dd50039129998090008a6103d87a80001323232325333013337220100042a66602666e3c0200084cdd2a40006602e6e980052f5c02980103d87a8000133006006003375660280066eb8c048008c058008c0500054ccc030cdc3a4000601a6ea800c54ccc03cc038dd50018a4c2c2c6eb8c040c034dd50008b1807980800118070009807001180600098041baa00114984d958dd68009bae0015734aae7555cf2ab9f5740ae855d11",
      [utxo.txHash, BigInt(utxo.outputIndex)]
    ),
  }
}

let alwaysFail = {
  type: "PlutusV3",
  script: "587501010032323232323225333002323232323253330073370e900118041baa0011323232326533300a3370e900018059baa0051533300d300c375400a2930b0b18069807001180600098049baa00116300a300b0023009001300900230070013004375400229309b2b2b9a5573aaae7955cfaba15745"
}

const equityNft = equityScript(uniqRef)
const equityNftSymbol = L.mintingPolicyToId(equityNft)

const alwaysFailAddress = L.validatorToAddress(lucid.config().network, alwaysFail)

const tx =
  await lucid.newTx()
    .collectFrom([uniqRef])
    .pay.ToContract(alwaysFailAddress, undefined, undefined, equityNft)
    .mintAssets({
      [equityNftSymbol+"00"]: 1_000_000_000n
    }, L.Data.to(new L.Constr(0, [])))
    .attach.MintingPolicy(equityNft)
    .complete()

const signed = await tx.sign.withWallet().complete()
const hash = await signed.submit()

console.log(hash)
await lucid.awaitTx(hash, 40_000)

console.log("submission confirmed")
console.log(`Equity currency symbol ${equityNftSymbol}`)

const allUtxos = await lucid.utxosAt(alwaysFailAddress);
const refScriptUtxos = allUtxos.filter((utxo) => utxo.scriptRef.script == equityNft.script)[0];

console.log(`contract ref script at`)
console.log(refScriptUtxos)
