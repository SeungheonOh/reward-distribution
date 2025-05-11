use cardano/transaction as tx
use cardano/assets
use aiken/collection/list
use aiken/collection/dict
use aiken/primitive/bytearray
use aiken/crypto.{
  Blake2b_256, Hash
}

validator equityToken(uniqRefHash: Hash<Blake2b_256, tx.Transaction>, uniqRefIdx: Int) {
  mint(_redeemer: Void, ownPolicy: assets.PolicyId, self: tx.Transaction) {
    let usesUniqRef =
      self.inputs |> list.any(fn (input) {
        input.output_reference == tx.OutputReference(uniqRefHash, uniqRefIdx)
      })

    if usesUniqRef { True }
    else {
      expect [Pair(nameA, amountA), Pair(nameB, amountB)] =
        self.mint
        |> assets.tokens(ownPolicy)
        |> dict.to_pairs

      let idxA = bytearray.to_int_big_endian(nameA)
      let idxB = bytearray.to_int_big_endian(nameB)

      if idxA > idxB {
        amountA == -amountB && amountA > 0
      }
      else {
        amountB == -amountA && amountB > 0
      }
    }
  }
}

// test foo() {
//   bytearray.to_int_big_endian(#"000005") == 5
// }
