use cardano/transaction as tx
use cardano/assets
use cardano/address
use aiken/math
use aiken/collection/list
use aiken/collection/dict
use aiken/primitive/bytearray
use aiken/crypto.{
  Blake2b_256, Hash
}

validator rewardpool(
  uniqRefHash: Hash<Blake2b_256, tx.Transaction>,
  uniqRefIdx: Int,
  equityTokenPolicy: assets.PolicyId,
  rewardAssetPolicy: assets.PolicyId,
  rewardAssetName: assets.AssetName
  ) {
  mint(_redeemer: Void, ownPolicy: assets.PolicyId, self: tx.Transaction) {
    let usesUniqRef =
      self.inputs |> list.any(fn (input) {
        input.output_reference == tx.OutputReference(uniqRefHash, uniqRefIdx)
      })
    expect [Pair(_, 1)] = self.mint |> assets.tokens(ownPolicy) |> dict.to_pairs
    usesUniqRef
  }
  spend(_datum: Option<Void>, _redeemer: Void, ownRef: tx.OutputReference, self: tx.Transaction) {
    expect Some(ownInput) =
      self.inputs |> list.find(fn(input) { input.output_reference == ownRef })
    let ownAddress = ownInput.output.address
    expect address.Script(ownScriptHash) = ownAddress.payment_credential

    expect [Pair(myPoolName, 1)] = ownInput.output.value |> assets.tokens(ownScriptHash) |> dict.to_pairs
    let myPoolIdx = bytearray.to_int_big_endian(myPoolName)

    expect [ownOutput] =
      self.outputs
      |> list.filter(fn(o) {
        and {
          o.address == ownAddress,
          assets.quantity_of(o.value, ownScriptHash, myPoolName) == 1,
        }
      })
    let withdrawAmount =
      assets.quantity_of(ownInput.output.value, rewardAssetPolicy, rewardAssetName) - assets.quantity_of(ownOutput.value, rewardAssetPolicy, rewardAssetName)

    expect [Pair(nameA, amountA), Pair(nameB, amountB)] =
      self.mint
      |> assets.tokens(equityTokenPolicy)
      |> dict.to_pairs

    let idxA = bytearray.to_int_big_endian(nameA)
    let idxB = bytearray.to_int_big_endian(nameB)
    let equityIdxFrom = math.min(idxA, idxB)
    let equityIdxTo = math.max(idxA, idxB)
    let maxRewardWithdrawl = math.abs(amountA - amountB)

    let correctWithdrawAmount =
      maxRewardWithdrawl * 1 >= withdrawAmount // change 1 to target exchange rate

    let correctIndexIncrement = equityIdxFrom <= myPoolIdx && myPoolIdx < equityIdxTo

    and {
      correctWithdrawAmount,
      correctIndexIncrement,
    }
  }
}
