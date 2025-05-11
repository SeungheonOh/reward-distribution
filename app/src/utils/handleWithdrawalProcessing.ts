import { type Lucid } from '@lucid-evolution/lucid';
import * as L from '@lucid-evolution/lucid';

// Simplified pool info needed for withdrawal processing logic
export interface WithdrawalPoolParams {
    name: string;
    index: number;
    userTokenUnit: string | null; // The specific equity token unit for this user for this pool
    userTokenAmount: bigint | null; // Amount of that specific equity token
    poolScriptReference: string; // Needed for interacting with the pool script
    // Add any other specific fields required for the transaction from DisplayableRewardPool
}

export interface ProcessWithdrawalArgs {
    lucid: any; // Changed Lucid to any to resolve linter error
    targetPool: WithdrawalPoolParams;
    intermediatePools: WithdrawalPoolParams[];
    amount: string; // Amount from user input, context depends on how it's used by pool scripts
    equityNFTScriptORef: { txHash: string; outputIndex: number; }; // Added equity NFT script ORef
}

/**
 * Handles the core logic for processing a withdrawal, including intermediate pools.
 * This is a placeholder for the actual transaction building.
 * @returns Promise<string> - Placeholder for a transaction hash or status message.
 */
export async function processWithdrawal(
    { lucid, targetPool, intermediatePools, amount, equityNFTScriptORef }: ProcessWithdrawalArgs
): Promise<string> {
    let withdrawAmount = BigInt(amount)
    console.log("Processing withdrawal for target pool:", targetPool.name, "(Index:", targetPool.index, ")");
    if (intermediatePools.length > 0) {
        console.log("Including intermediate pools:", intermediatePools.map(p => `${p.name} (Index: ${p.index})`));
    }
    console.log("User's qualifying token for this operation:", targetPool.userTokenUnit);
    console.log("Amount of this token held:", targetPool.userTokenAmount);
    console.log("Amount from input for target pool (or cascade):", withdrawAmount);

    console.log(equityNFTScriptORef)    
    const [equityNftRefUtxo] = await lucid.utxosByOutRef([equityNFTScriptORef])

    const equityNft = equityNftRefUtxo.scriptRef
    const equityNftSymbol = L.mintingPolicyToId(equityNft)

    const poolScriptTxHash = targetPool.poolScriptReference.split("#")[0]
    const poolScriptOutputIndex = parseInt(targetPool.poolScriptReference.split("#")[1], 10)
    const poolScriptORef = { txHash: poolScriptTxHash, outputIndex: poolScriptOutputIndex }
    const [poolScriptUtxo] = await lucid.utxosByOutRef([poolScriptORef])
    const poolScript = poolScriptUtxo.scriptRef
    const poolNftSymbol = L.mintingPolicyToId(poolScript)
    const poolAddress = L.validatorToAddress(lucid.config().network, poolScript)

    const poolUtxos = await lucid.utxosAt(poolAddress)
    const [poolUtxo] = poolUtxos.filter(x => Object.entries(x.assets).some(([unit, _]) => unit.slice(0, 56) == poolNftSymbol))

    const poolIdx = (Object.entries(poolUtxo.assets).find(([unit, _]) => unit.slice(0, 56) == poolNftSymbol)[0]).slice(56)

    console.log(poolUtxo)
    console.log(`0x${poolIdx}`)

    const nextPoolIdx = (parseInt(poolIdx, 16) + 1).toString(16).padStart(2, '0')

    const tx =
        await lucid.newTx()
            .readFrom([equityNftRefUtxo, poolScriptUtxo])
            .collectFrom([poolUtxo], L.Data.to(new L.Constr(0, [])))
            .pay.ToContract(poolAddress, { kind: "inline", value: L.Data.to([]) }, {
                lovelace: poolUtxo.assets.lovelace - withdrawAmount,
                [poolNftSymbol + poolIdx]: 1n,
            }, undefined)
            .mintAssets({
                [equityNftSymbol + "00"]: -withdrawAmount,
                [equityNftSymbol + nextPoolIdx]: withdrawAmount
            }, L.Data.to(new L.Constr(0, [])))
            .complete()

    const signed = await tx.sign.withWallet().complete()
    const hash = await signed.submit()

    console.log(hash)

    await lucid.awaitTx(hash, 40_000)

    return hash
} 