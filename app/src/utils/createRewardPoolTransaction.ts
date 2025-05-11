import * as L from '@lucid-evolution/lucid';

interface CreateRewardPoolParams {
    lucid: any; // Using any for now, similar to the change in mintEquityTransaction.ts
    poolId: number;
    poolDescription: string;
    totalAmountInPool: number;
    equityTokenTxHash: string; // Changed from equityTokenReferenceInput
    equityTokenOutputIndex: number; // New field for the output index
    walletAddress: string;
}

interface CreateRewardPoolResult {
    txHash: string;
    poolScriptReference: string;
}

/**
 * Placeholder for creating a reward pool transaction.
 * This function will need to be implemented with actual Lucid transaction building logic.
 * - Define the validator script for the reward pool.
 * - Construct the transaction to create the pool UTXO with the specified tokens and datum.
 * - Include the equity token transaction hash and output index in the transaction construction.
 * - Sign and submit the transaction.
 * - Return the transaction hash and the generated pool script reference.
 */
export async function createRewardPoolTransaction(params: CreateRewardPoolParams): Promise<CreateRewardPoolResult> {
    console.log('Attempting to create reward pool with params:', params);

    if (!params.lucid) {
        throw new Error('Lucid instance is not initialized.');
    }
    if (!params.walletAddress) {
        throw new Error('Wallet address is not available.');
    }
    if (params.poolId < 0) {
        throw new Error('Pool ID must be a non-negative number.');
    }
    if (!params.poolDescription.trim()) {
        throw new Error('Pool description cannot be empty.');
    }
    if (params.totalAmountInPool <= 0) {
        throw new Error('Total amount in pool must be greater than 0.');
    }
    if (!params.equityTokenTxHash.trim()) {
        throw new Error('Equity token transaction hash cannot be empty.');
    }
    if (params.equityTokenOutputIndex < 0) {
        throw new Error('Equity token output index must be a non-negative number.');
    }

    const lucid = params.lucid;

    try {
        const buildPoolScript = (utxo: any, equitySymbol: any) => {
            return {
                type: "PlutusV3",
                script: L.applyParamsToScript(
                    "59043e010100323232323232322322322322322322533300c3232323232323232323232325323330193001008132323232533302030230021533301d3009375a603e00220062c2c60420026600c6eacc014c074dd50071bae3020301d375401664660020026eb0c010c074dd500711299980f8008a50132533301d3375e600c603e6ea8c088008c02ccc084dd480d998109ba80194bd700a51133003003001302200153330193001301a37540142a66603860366ea8028526161615333019300500813232323232533301e3006301f3754002264646464a666044601c60466ea80044c8c8c94ccc0a0c0ac0084c94ccc098c048dd6981400109919191929998169818001099191919192999819181a8010991919191919299981a99b8900b3370464a66606c66e2000520001337029000000880099b81375a606e0126eb4c0dc01d2002100114a0a66606866e254ccc0d0cdc400100188010801807099b8800e00114a0a66606666e2000400840084004cde525100233794944008dd718188011bae303000316303300130330023031001330163756602a605a6ea8078094cdc09998019bab300b302c3754601660586ea8030088080ccc00cdd5980598161baa00102202016302e00132330010013758605c605e605e60566ea8070894ccc0b400452f5c026464a666058a66605866ebcc054c0b8dd50010060980c1998029bab300d302e375400401400e29404cc0c0008cc0100100044cc010010004c0c4008c0bc004888c94ccc0acc05cc0b0dd50008a400026eb4c0c0c0b4dd5000992999815980b98161baa00114c103d87a80001323300100137566062605c6ea8008894ccc0c0004530103d87a80001323232325333031337220100042a66606266e3c0200084c07ccc0d4dd4000a5eb80530103d87a8000133006006003375a60640066eb8c0c0008c0d0008c0c8004cc05c00c008cde525100116375c604c0022c60520026601c6eacc010c094dd5180218129baa005001375c604e60486ea800458c028c08cdd5000980498111baa3001302237540044604a604c002604660406ea800458c8cc004004dd6180398101baa01122533302200114c103d87a80001323253330213375e601460466ea800801c4c03ccc0940092f5c0266008008002604c0046048002a6660386008603a6ea803454ccc07cc078dd50068a4c2c2c60406042004603e00260366ea802458dc3a40004603a00246038603a603a603a603a0024464a666030600860326ea800452f5bded8c026eacc074c068dd5000998020010009b874800888c8cc00400400c894ccc0680045300103d87a8000132323232533301b3372200e0042a66603666e3c01c0084c024cc07cdd3000a5eb80530103d87a8000133006006003375660380066eb8c068008c078008c070004dd2a400060246ea8004c054c058008c050004c050008c048004c038dd50008a4c26cac6eb8004dd70009bae001375a0026eb80055cd2ab9d5573caae7d5d02ba157441",
                    [utxo.txHash,
                    BigInt(utxo.outputIndex),
                        equitySymbol,
                        "",
                        "",
                    ]
                ),
            } as L.Script
        }

        let alwaysFail = {
            type: "PlutusV3",
            script: "587501010032323232323225333002323232323253330073370e900118041baa0011323232326533300a3370e900018059baa0051533300d300c375400a2930b0b18069807001180600098049baa00116300a300b0023009001300900230070013004375400229309b2b2b9a5573aaae7955cfaba15745"
        } as L.Script

        const equityNftScriptORef = { txHash: params.equityTokenTxHash, outputIndex: params.equityTokenOutputIndex }
        const [equityNftRefUtxo] = await lucid.utxosByOutRef([equityNftScriptORef])
        const equityNft = equityNftRefUtxo.scriptRef
        const equityNftSymbol = L.mintingPolicyToId(equityNft)
        const alwaysFailAddress = L.validatorToAddress(lucid.config().network, alwaysFail)

        const uniqRef = (await lucid.wallet().getUtxos())[0]
        const poolScript = buildPoolScript(uniqRef, equityNftSymbol)

        const poolNftSymbol = L.mintingPolicyToId(poolScript)
        const poolAddress = L.validatorToAddress(lucid.config().network, poolScript)
        const poolIdHex = params.poolId.toString(16).padStart(2, '0')

        const tx =
            await lucid.newTx()
                .collectFrom([uniqRef])
                .pay.ToContract(alwaysFailAddress, undefined, undefined, poolScript)
                .pay.ToContract(poolAddress, { kind: "inline", value: L.Data.to([]) }, {
                    lovelace: params.totalAmountInPool,
                    [poolNftSymbol + poolIdHex]: 1n,
                }, undefined)
                .mintAssets({
                    [poolNftSymbol + poolIdHex]: 1n,
                }, L.Data.to(new L.Constr(0, [])))
                .attach.MintingPolicy(poolScript)
                .complete()

        const signed = await tx.sign.withWallet().complete()
        const hash = await signed.submit()

        console.log(hash)
        await lucid.awaitTx(hash, 40_000)

        const allUtxos = await lucid.utxosAt(alwaysFailAddress);
        const refScriptUtxo = allUtxos.filter((utxo: any) => utxo.scriptRef.script == poolScript.script)[0];

        console.log(`pool contract ref script at`)
        console.log(refScriptUtxo)
                    
        return {
            txHash: hash,
            poolScriptReference: `${refScriptUtxo.txHash}#${refScriptUtxo.outputIndex}`
        };

    } catch (error) {
        console.error('Error creating reward pool transaction (placeholder):', error);
        if (error instanceof Error) {
            throw new Error(`Failed to create reward pool transaction: ${error.message}`);
        }
        throw new Error('An unknown error occurred during reward pool transaction creation.');
    }
}

async function exampleUsage(lucid: any, walletAddress: string) {
    try {
        const result = await createRewardPoolTransaction({
            lucid: lucid,
            poolId: 123,
            poolDescription: "Rewards for tokens staked in Q2 2024.",
            totalAmountInPool: 15000,
            equityTokenTxHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            equityTokenOutputIndex: 0,
            walletAddress: walletAddress,
        });
        console.log(`Reward pool creation transaction submitted with hash: ${result.txHash}`);
        console.log(`Generated Pool Script Reference: ${result.poolScriptReference}`);
    } catch (error) {
        console.error('Error creating reward pool transaction:', error);
        if (error instanceof Error) {
            throw new Error(`Failed to create reward pool transaction: ${error.message}`);
        }
        throw new Error('An unknown error occurred during reward pool transaction creation.');
    }
}