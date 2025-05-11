import { useState, useEffect, type ChangeEvent, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { type Lucid, type UTxO as LucidUTxO, type Network as LucidNetwork } from '@lucid-evolution/lucid';
import * as L_Namespace from '@lucid-evolution/lucid';
import { processWithdrawal, type WithdrawalPoolParams, type ProcessWithdrawalArgs } from '../utils/handleWithdrawalProcessing';

interface ReferenceUtxo {
  txHash: string;
  outputIndex: number;
}

interface UserDashboardProps {
  lucidInstance: any;
  appNetwork?: LucidNetwork | null;
}

interface AssetHoldingsByIndex {
  [tokenIndex: number]: bigint; 
}

interface RewardPoolConfig {
  index: number;
  name: string;
  description: string;
  poolScriptReference: string;
  totalAmountInPool: number;
  status: 'active' | 'pending' | 'completed';
}

interface RewardConfigsMap {
  [policyId: string]: RewardPoolConfig[];
}

interface QualifyingTokenInfo {
  unit: string;
  amount: bigint;
  tokenIndex: number;
}

interface DisplayableRewardPool extends RewardPoolConfig {
  qualifyingUserTokens: QualifyingTokenInfo[];
}

export default function UserDashboard({ lucidInstance, appNetwork }: UserDashboardProps) {
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const [referenceScriptInput, setReferenceScriptInput] = useState<string>('');
  const [isReferenceScriptSet, setIsReferenceScriptSet] = useState<boolean>(false);
  const [referenceUtxo, setReferenceUtxo] = useState<ReferenceUtxo | null>(null);
  const [isLoadingReference, setIsLoadingReference] = useState<boolean>(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [userEquityHoldingsByIndex, setUserEquityHoldingsByIndex] = useState<AssetHoldingsByIndex>({});
  
  const [rewardConfigsMap, setRewardConfigsMap] = useState<RewardConfigsMap | null>(null);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [displayablePools, setDisplayablePools] = useState<DisplayableRewardPool[]>([]);

  const [showWithdrawCascadeModal, setShowWithdrawCascadeModal] = useState<boolean>(false);
  const [withdrawCascadeDetails, setWithdrawCascadeDetails] = useState<{
    targetPool: DisplayableRewardPool;
    intermediatePools: DisplayableRewardPool[];
    amountForTargetPool: string;
  } | null>(null);

  const [isProcessingWithdrawal, setIsProcessingWithdrawal] = useState<boolean>(false);
  const [withdrawalTxHash, setWithdrawalTxHash] = useState<string | null>(null);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);

  const [chosenTokenForWithdrawal, setChosenTokenForWithdrawal] = useState<QualifyingTokenInfo | null>(null);
  const [showTokenSelectorModal, setShowTokenSelectorModal] = useState<boolean>(false);
  const [poolForTokenSelection, setPoolForTokenSelection] = useState<DisplayableRewardPool | null>(null);

  // State for reloading data
  const [isReloadingData, setIsReloadingData] = useState<boolean>(false);
  const [reloadDataError, setReloadDataError] = useState<string | null>(null);
  const [lastReloadTime, setLastReloadTime] = useState<Date | null>(null);

  useEffect(() => {
    async function fetchConfigs() {
      setIsLoadingConfigs(true);
      try {
        const response = await fetch('/rewardPoolsConfig.json');
        if (!response.ok) {
          throw new Error(`Failed to fetch reward configs: ${response.statusText}`);
        }
        const data: RewardConfigsMap = await response.json();
        setRewardConfigsMap(data);
        setConfigError(null);
      } catch (error) {
        console.error("Error fetching reward pool configs:", error);
        setConfigError(error instanceof Error ? error.message : String(error));
        setRewardConfigsMap(null);
      } finally {
        setIsLoadingConfigs(false);
      }
    }
    fetchConfigs();
  }, []);

  const getIndexFromFriendlyName = (friendlyName: string): number | null => {
    const match = friendlyName.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  };

  useEffect(() => {
    if (!lucidInstance || !policyId || !rewardConfigsMap || !userEquityHoldingsByIndex) { 
      setDisplayablePools([]);
      return;
    }

    const currentEquityPoolConfigs = rewardConfigsMap[policyId];
    if (!currentEquityPoolConfigs || currentEquityPoolConfigs.length === 0) {
      setDisplayablePools([]);
      return;
    }

    const newDisplayablePools = currentEquityPoolConfigs.map(config => {
      const qualifyingTokensForPool: QualifyingTokenInfo[] = [];

      if (Object.keys(userEquityHoldingsByIndex).length > 0) {
        for (const [indexStr, amount] of Object.entries(userEquityHoldingsByIndex)) {
          const userTokenIdx = parseInt(indexStr, 10);
          if (userTokenIdx <= config.index) { // Token qualifies if its index is <= pool index
            const assetNameHex = userTokenIdx.toString(16).padStart(2, '0');
            qualifyingTokensForPool.push({
              unit: policyId + assetNameHex,
              amount: amount,
              tokenIndex: userTokenIdx
            });
          }
        }
      }
      
      // Sort qualifying tokens by index, highest first (optional, but might be good for UI)
      qualifyingTokensForPool.sort((a, b) => b.tokenIndex - a.tokenIndex);

      return {
         ...config,
         qualifyingUserTokens: qualifyingTokensForPool
      };
    });
    setDisplayablePools(newDisplayablePools);

  }, [lucidInstance, policyId, rewardConfigsMap, userEquityHoldingsByIndex]);

  const handleReferenceInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setReferenceScriptInput(e.target.value);
    setReferenceError(null);
  };

  const handleSetReferenceScript = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setReferenceError(null);
    setReloadDataError(null);
    setLastReloadTime(null);
    setIsLoadingReference(true);
    setUserEquityHoldingsByIndex({});
    setPolicyId(null); 
    setDisplayablePools([]);

    if (!lucidInstance) {
      setReferenceError('Lucid instance not available. Please connect your wallet.');
      setIsLoadingReference(false);
      return;
    }
    const parts = referenceScriptInput.split('#');
    if (parts.length !== 2 || !parts[0].trim() || isNaN(parseInt(parts[1], 10))) {
      setReferenceError('Invalid format. Please use txHash#outputIndex (e.g., abcdef...#0)');
      setIsLoadingReference(false);
      return;
    }
    const txHash = parts[0].trim();
    const outputIndex = parseInt(parts[1], 10);

    try {
      const equityNftScriptORef = { txHash, outputIndex };
      const utxos = await lucidInstance.utxosByOutRef([equityNftScriptORef]);
      if (!utxos || utxos.length === 0) {
        setReferenceError('Reference UTXO not found.');
        setIsLoadingReference(false);
        return;
      }
      const equityNftRefUtxo = utxos[0];
      if (!equityNftRefUtxo.scriptRef) {
        setReferenceError('Reference UTXO does not contain a script reference.');
        setIsLoadingReference(false);
        return;
      }
      const equityNftScript = equityNftRefUtxo.scriptRef;
      const calculatedPolicyId = L_Namespace.mintingPolicyToId(equityNftScript);
      setPolicyId(calculatedPolicyId);

      const walletUtxos: LucidUTxO[] = await lucidInstance.wallet().getUtxos();
      const newHoldingsByIndex: AssetHoldingsByIndex = {};

      for (const utxo of walletUtxos) {
        for (const assetUnit in utxo.assets) {
          if (assetUnit.startsWith(calculatedPolicyId)) {
            const amount = utxo.assets[assetUnit];
            const friendlyName = typeof lucidInstance.utils?.assetsToFriendlyName === 'function'
              ? lucidInstance.utils.assetsToFriendlyName({ [assetUnit]: amount })
              : assetUnit;
            const tokenIndex = getIndexFromFriendlyName(friendlyName);

            if (tokenIndex !== null) {
              newHoldingsByIndex[tokenIndex] = (newHoldingsByIndex[tokenIndex] || 0n) + amount;
            }
          }
        }
      }
      
      setUserEquityHoldingsByIndex(newHoldingsByIndex);
      setPolicyId(calculatedPolicyId);

      console.log('User Equity Holdings By Index:', newHoldingsByIndex);
      console.log(`Fetched reference: ${txHash}#${outputIndex}`);
      console.log(`Policy ID loaded: ${calculatedPolicyId}`);
      setReferenceUtxo({ txHash, outputIndex });
      setIsReferenceScriptSet(true);
      setLastReloadTime(new Date());
    } catch (err) {
      console.error("Error fetching or processing reference UTXO:", err);
      setReferenceError(`Failed to load script: ${err instanceof Error ? err.message : String(err)}`);
      setPolicyId(null);
      setUserEquityHoldingsByIndex({});
    } finally {
      setIsLoadingReference(false);
    }
  };

  const handleReloadData = async () => {
    if (!lucidInstance || !policyId) {
      setReloadDataError("Cannot reload data: Lucid instance or Policy ID is not available.");
      return;
    }
    setIsReloadingData(true);
    setReloadDataError(null);
    try {
      const walletUtxos: LucidUTxO[] = await lucidInstance.wallet().getUtxos();
      const newHoldingsByIndex: AssetHoldingsByIndex = {};

      for (const utxo of walletUtxos) {
        for (const assetUnit in utxo.assets) {
          if (assetUnit.startsWith(policyId)) {
            const amount = utxo.assets[assetUnit];
            const friendlyName = typeof lucidInstance.utils?.assetsToFriendlyName === 'function'
              ? lucidInstance.utils.assetsToFriendlyName({ [assetUnit]: amount })
              : assetUnit;
            const tokenIndex = getIndexFromFriendlyName(friendlyName);

            if (tokenIndex !== null) {
              newHoldingsByIndex[tokenIndex] = (newHoldingsByIndex[tokenIndex] || 0n) + amount;
            }
          }
        }
      }
      console.log('newHoldingsByIndex', newHoldingsByIndex);
      setUserEquityHoldingsByIndex(newHoldingsByIndex);
      console.log('User Equity Holdings By Index (Reloaded):', newHoldingsByIndex);
      setLastReloadTime(new Date());
    } catch (err) {
      console.error("Error reloading user data:", err);
      setReloadDataError(`Failed to reload data: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsReloadingData(false);
    }
  };

  const initiateWithdrawalProcess = (targetPoolConfigIndex: string, token: QualifyingTokenInfo) => {
    const targetPool = displayablePools.find(p => String(p.index) === targetPoolConfigIndex);
    if (!targetPool || !token) { 
      console.error("Cannot initiate withdrawal: Target pool or chosen token info is invalid.");
      return;
    }
    setSelectedPool(targetPoolConfigIndex);
    setChosenTokenForWithdrawal(token);
    setWithdrawAmount(token.amount.toString());
    setShowTokenSelectorModal(false);
    setPoolForTokenSelection(null);
  };

  const openTokenSelector = (pool: DisplayableRewardPool) => {
    setPoolForTokenSelection(pool);
    setShowTokenSelectorModal(true);
  };

  const mapPoolToWithdrawalParams = (pool: DisplayableRewardPool, selectedToken: QualifyingTokenInfo): WithdrawalPoolParams => ({
    name: pool.name,
    index: pool.index,
    userTokenUnit: selectedToken.unit,
    userTokenAmount: selectedToken.amount,
    poolScriptReference: pool.poolScriptReference,
  });

  const getCardanoscanBaseUrl = () => {
    if (!appNetwork) return 'https://cardanoscan.io';
    switch (appNetwork) {
      case 'Mainnet': return 'https://cardanoscan.io';
      case 'Preprod': return 'https://preprod.cardanoscan.io';
      case 'Preview': return 'https://preview.cardanoscan.io';
      default: console.warn(`Unknown network for Cardanoscan: ${appNetwork}`); return `https://cardanoscan.io`;
    }
  };

  const handleConfirmAmountAndCheckCascade = async () => {
    if (selectedPool === null || !lucidInstance) {
        setReferenceError("Lucid instance not available or no pool selected.");
        setSelectedPool(null);
        setChosenTokenForWithdrawal(null);
        return;
    }
    if (!referenceUtxo) {
        setWithdrawalError("Equity token reference script is not set. Please set it first.");
        setSelectedPool(null);
        setChosenTokenForWithdrawal(null);
        return;
    }
    if (!chosenTokenForWithdrawal) {
        setWithdrawalError("No specific equity token was selected for withdrawal.");
        setSelectedPool(null);
        setChosenTokenForWithdrawal(null);
        return;
    }
    if (!policyId) {
        setWithdrawalError("Policy ID is not available. Cannot proceed.");
        setSelectedPool(null);
        setChosenTokenForWithdrawal(null);
        return;
    }

    const targetPool = displayablePools.find(p => String(p.index) === selectedPool);
    if (!targetPool) {
      console.error("Error in confirm: Target pool not found (this should not happen).");
      setWithdrawalError("Target pool not found.");
      setSelectedPool(null); 
      setChosenTokenForWithdrawal(null);
      return;
    }

    const userTokenCurrentIdx = chosenTokenForWithdrawal.tokenIndex;

    const intermediatePoolsToProcess = displayablePools.filter(p => {
      if (p.index >= userTokenCurrentIdx && p.index < targetPool.index && p.status === 'active') {
        const chosenTokenQualifiesForIntermediate = p.qualifyingUserTokens.some(qToken => qToken.unit === chosenTokenForWithdrawal.unit);
        return chosenTokenQualifiesForIntermediate;
      }
      return false;
    }).sort((a, b) => a.index - b.index);

    const currentWithdrawAmount = withdrawAmount;
    setSelectedPool(null); 

    setIsProcessingWithdrawal(true);
    setWithdrawalTxHash(null);
    setWithdrawalError(null);
    try {
      const txResult = await processWithdrawal({
          lucid: lucidInstance,
          targetPool: mapPoolToWithdrawalParams(targetPool, chosenTokenForWithdrawal),
          intermediatePools: intermediatePoolsToProcess.map(p => mapPoolToWithdrawalParams(p, chosenTokenForWithdrawal)),
          amount: currentWithdrawAmount,
          equityNFTScriptORef: referenceUtxo
      } as ProcessWithdrawalArgs);
      setWithdrawalTxHash(txResult);
      if (txResult) {
        handleReloadData();
      }
    } catch (error) {
      setWithdrawalError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsProcessingWithdrawal(false);
      setWithdrawAmount(''); 
    }
  };

  const handleConfirmCascadeWithdraw = async () => {
    if (withdrawCascadeDetails && lucidInstance) {
      if (!referenceUtxo) {
        setWithdrawalError("Equity token reference script is not set. Please set it first.");
        setShowWithdrawCascadeModal(false);
        setWithdrawCascadeDetails(null);
        setChosenTokenForWithdrawal(null);
        return;
      }
      if (!chosenTokenForWithdrawal) {
          setWithdrawalError("No specific equity token was selected for withdrawal. Please close modal and retry.");
          return;
      }

      setIsProcessingWithdrawal(true);
      setWithdrawalTxHash(null);
      setWithdrawalError(null);
      try {
        const txResult = await processWithdrawal({
            lucid: lucidInstance,
            targetPool: mapPoolToWithdrawalParams(withdrawCascadeDetails.targetPool, chosenTokenForWithdrawal),
            intermediatePools: withdrawCascadeDetails.intermediatePools.map(p => mapPoolToWithdrawalParams(p, chosenTokenForWithdrawal)),
            amount: withdrawCascadeDetails.amountForTargetPool,
            equityNFTScriptORef: referenceUtxo
        } as ProcessWithdrawalArgs);
        setWithdrawalTxHash(txResult);
        if (txResult) {
          handleReloadData();
        }
      } catch (error) {
        setWithdrawalError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsProcessingWithdrawal(false);
        setShowWithdrawCascadeModal(false);
        setWithdrawCascadeDetails(null);
        setWithdrawAmount(''); 
      }
    }
  };

  const handleCancelCascadeWithdraw = () => {
    setShowWithdrawCascadeModal(false);
    setWithdrawCascadeDetails(null);
    setWithdrawAmount('');
    setChosenTokenForWithdrawal(null);
  };

  if (!isReferenceScriptSet) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-md shadow-soft rounded-xl p-6 sm:p-8 w-full max-w-lg text-center"
        >
          <h2 className="text-2xl font-bold mb-6 text-black">Set Equity Token Reference</h2>
          <p className="text-black mb-6 text-sm">
            Please provide the reference UTXO (txHash#outputIndex) that holds the minting policy script for the equity tokens.
          </p>
          <form onSubmit={handleSetReferenceScript} className="space-y-4">
            <div>
              <label htmlFor="reference-script" className="sr-only">
                Reference Output (txHash#outputIndex)
              </label>
              <input
                type="text"
                id="reference-script"
                value={referenceScriptInput}
                onChange={handleReferenceInputChange}
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200 p-3"
                placeholder="e.g., a1b2c3d4...#0"
                disabled={isLoadingReference}
              />
            </div>
            <motion.button
              type="submit"
              whileHover={{ scale: !isLoadingReference ? 1.02 : 1 }}
              whileTap={{ scale: !isLoadingReference ? 0.98 : 1 }}
              disabled={isLoadingReference || !referenceScriptInput.trim()}
              className={`w-full py-3 px-4 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200 flex items-center justify-center space-x-2 ${isLoadingReference || !referenceScriptInput.trim()
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-primary-600 to-secondary-600 text-white hover:from-primary-700 hover:to-secondary-700'
                }`}
            >
              {isLoadingReference && (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              <span>{isLoadingReference ? 'Loading Script...' : 'Load Script'}</span>
            </motion.button>
          </form>
          {referenceError && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-500 text-sm mt-4"
            >
              {referenceError}
            </motion.p>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-white/80 backdrop-blur-md shadow-soft rounded-xl p-4 mb-6 text-sm">
        <p className="text-black">
          Equity Token Script Reference:
          <span className="font-mono bg-gray-100 p-1 rounded text-primary-600">
            {referenceUtxo?.txHash}#{referenceUtxo?.outputIndex}
          </span>
        </p>
        {policyId && (
          <p className="text-black text-xs mt-1">
            Policy ID: <span className="font-mono bg-gray-100 p-1 rounded">{policyId}</span>
          </p>
        )}
        <div className="mt-3 flex items-center space-x-3">
            <motion.button
              onClick={handleReloadData}
              disabled={!isReferenceScriptSet || isReloadingData || isLoadingReference}
              whileHover={{ scale: !isReloadingData && !isLoadingReference ? 1.03 : 1 }}
              whileTap={{ scale: !isReloadingData && !isLoadingReference ? 0.97 : 1 }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 flex items-center justify-center space-x-1.5 ${(!isReferenceScriptSet || isReloadingData || isLoadingReference)
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1'
              }`}
            >
              {isReloadingData ? (
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
              )}
              <span>{isReloadingData ? 'Reloading...' : 'Reload Data'}</span>
            </motion.button>
            {lastReloadTime && !isReloadingData && (
              <p className="text-xs text-black">Last updated: {lastReloadTime.toLocaleTimeString()}</p>
            )}
        </div>
        {reloadDataError && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-500 text-xs mt-2"
            >
              {reloadDataError}
            </motion.p>
        )}

        {Object.keys(userEquityHoldingsByIndex).length > 0 && lucidInstance && policyId && (
          <div className="mt-4">
            <h3 className="text-md font-semibold text-black mb-2">Your Equity Token Holdings (All under this Policy ID):</h3>
            <ul className="list-disc pl-5 space-y-1">
              {Object.entries(userEquityHoldingsByIndex).map(([indexStr, amount]) => {
                const tokenIndex = parseInt(indexStr, 10);
                // Construct unit using policyId and tokenIndex (hex padded to 2 chars)
                const assetNameHex = tokenIndex.toString(16).padStart(2, '0');
                const unit = policyId + assetNameHex;

                return (
                  <li key={tokenIndex} className="text-xs text-black">
                    <span className="font-mono bg-gray-100 p-0.5 rounded">
                      {(typeof lucidInstance.utils?.assetsToFriendlyName === 'function' ? 
                        lucidInstance.utils.assetsToFriendlyName({[unit]: amount}) : unit)} 
                    </span>: 
                    <span className="font-semibold"> {amount.toString()}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-md shadow-soft rounded-xl p-6"
      >
        <h2 className="text-2xl font-bold mb-6 text-black">
          Available Reward Pools for current Equity Token
        </h2>
        {isLoadingConfigs && <p className="text-black">Loading reward pool configurations...</p>}
        {configError && <p className="text-red-500">Error loading configurations: {configError}</p>}
        
        {!isLoadingConfigs && !configError && policyId && !rewardConfigsMap?.[policyId] && (
            <p className="text-black text-center py-4">No reward pool configurations found for the loaded equity token policy ID ({policyId}).</p>
        )}
        {!isLoadingConfigs && !configError && policyId && rewardConfigsMap?.[policyId] && displayablePools.length === 0 && (
            <p className="text-black text-center py-4">No reward pools available for your tokens under policy ID {policyId}, or no matching equity tokens found for configured pools.</p>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {displayablePools.map((pool) => (
              <motion.div
                key={pool.index}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="group relative bg-white rounded-xl shadow-soft hover:shadow-lg transition-all duration-300 overflow-hidden"
              >
                <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-primary-500 to-secondary-500"></div>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-black">{pool.name} (Index: {pool.index})</h3>
                    <span className={`px-3 py-1 text-xs font-medium rounded-full ${pool.status === 'active' 
                        ? 'bg-green-100 text-green-800' 
                        : pool.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {pool.status}
                    </span>
                  </div>
                  <p className="text-sm text-black mb-3">{pool.description}</p>
                  
                  <div className="mb-4">
                    <p className="text-sm text-black mb-1">Your Qualifying Equity (Total):</p>
                    <p className="text-xl font-bold text-primary-600">
                      {pool.qualifyingUserTokens.reduce((sum, token) => sum + token.amount, 0n).toString() || '0'}
                    </p>
                    {pool.qualifyingUserTokens.length > 0 ? (
                      <motion.button
                        onClick={() => openTokenSelector(pool)}
                        className="mt-2 w-full py-2 px-3 text-sm rounded-md font-medium bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 transition-all duration-200"
                      >
                        Select Token to Withdraw With ({pool.qualifyingUserTokens.length} eligible)
                      </motion.button>
                    ) : (
                      <p className="text-xs text-black italic mt-2">No specific equity token you hold qualifies for this pool's current index.</p>
                    )}
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-black mb-1">Total Rewards in Pool</p>
                    <p className="text-xl font-bold text-black">{pool.totalAmountInPool}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>

      <AnimatePresence>
        {isProcessingWithdrawal && (
            <motion.div 
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="fixed top-20 left-1/2 -translate-x-1/2 z-[150] p-3 bg-blue-500 text-white rounded-lg shadow-lg text-sm flex items-center space-x-2"
            >
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span>Processing withdrawal...</span>
            </motion.div>
        )}
        {withdrawalTxHash && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[150] p-3 bg-green-500 text-white rounded-lg shadow-lg text-sm text-center"
          >
            <p>Withdrawal Processed Successfully!</p>
            <p className="text-xs mt-1 truncate">Tx: {withdrawalTxHash}</p>
            {appNetwork && (
                <a href={`${getCardanoscanBaseUrl()}/transaction/${withdrawalTxHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-200 hover:text-blue-100 hover:underline mt-1 block">View on Cardanoscan ({appNetwork})</a>
            )}
            <button onClick={() => setWithdrawalTxHash(null)} className="mt-2 text-xs bg-green-600 hover:bg-green-700 px-2 py-0.5 rounded">Dismiss</button>
          </motion.div>
        )}
        {withdrawalError && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[150] p-3 bg-red-500 text-white rounded-lg shadow-lg text-sm text-center"
          >
            <p>Withdrawal Error:</p>
            <p className="text-xs mt-1">{withdrawalError}</p>
            <button onClick={() => setWithdrawalError(null)} className="mt-2 text-xs bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded">Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedPool !== null && (
          (() => {
            const currentPoolForModal = displayablePools.find(p => String(p.index) === selectedPool);
            if (!currentPoolForModal) return null;
            return (
              <motion.div /* Modal container */ onClick={() => {setSelectedPool(null); setWithdrawAmount(''); setChosenTokenForWithdrawal(null);}} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]">
                <motion.div /* Modal content */ onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 w-full max-w-md">
                  <h2 className="text-2xl font-bold mb-6 text-black">Withdraw from {currentPoolForModal.name} with Token Index {chosenTokenForWithdrawal?.tokenIndex}</h2>
                  <p className="text-sm text-black mb-4">
                    You are withdrawing with token: <span className="font-semibold">{chosenTokenForWithdrawal?.unit ? (lucidInstance?.utils?.assetsToFriendlyName?.({[chosenTokenForWithdrawal.unit]: chosenTokenForWithdrawal.amount}) || chosenTokenForWithdrawal.unit) : "N/A"}</span> (Amount: {chosenTokenForWithdrawal?.amount.toString()}).
                  </p>
                  <div>
                     <label htmlFor="withdraw-amount" className="block text-sm font-medium text-black">Amount to Withdraw</label>
                     <input
                       type="number"
                       id="withdraw-amount"
                       value={withdrawAmount}
                       onChange={(e) => setWithdrawAmount(e.target.value)}
                       className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200"
                       placeholder="Enter amount for this pool..."
                     />
                   </div>
                  <div className="flex space-x-3 mt-6">
                    <motion.button 
                      onClick={handleConfirmAmountAndCheckCascade} 
                      className="px-4 py-2 text-sm font-medium text-gray-800 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:bg-gray-300 disabled:text-gray-500 flex items-center justify-center space-x-2"
                      disabled={!withdrawAmount.trim() || parseFloat(withdrawAmount) <= 0 || isProcessingWithdrawal}
                    >
                      {isProcessingWithdrawal && selectedPool ? (
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      ) : null}
                      <span>{isProcessingWithdrawal && selectedPool ? 'Processing...' : 'Continue'}</span>
                    </motion.button>
                    <motion.button 
                      onClick={() => {setSelectedPool(null); setWithdrawAmount(''); setChosenTokenForWithdrawal(null);}} 
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      Cancel
                    </motion.button>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showWithdrawCascadeModal && withdrawCascadeDetails && (
          <motion.div /* Modal container */ onClick={handleCancelCascadeWithdraw} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]">
            <motion.div /* Modal content */ onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 w-full max-w-lg">
              <h2 className="text-xl font-bold mb-4 text-black">Confirm Cascading Withdrawal</h2>
              <p className="text-sm text-black mb-2">
You are targeting withdrawal from <span className="font-semibold">{withdrawCascadeDetails.targetPool.name} (Index: {withdrawCascadeDetails.targetPool.index})</span>.
              {withdrawCascadeDetails.amountForTargetPool && parseFloat(withdrawCascadeDetails.amountForTargetPool) > 0 && (
                <span> You specified an amount of <span className="font-semibold">{withdrawCascadeDetails.amountForTargetPool}</span> for this target pool.</span>
              )}
              </p>
              {withdrawCascadeDetails.intermediatePools.length > 0 && (
                <p className="text-sm text-black mb-4">
                  This action will also process withdrawals from the following prerequisite pool(s) using your token 
                  <span className="font-mono text-xs bg-gray-100 p-0.5 rounded">{typeof lucidInstance?.utils?.assetsToFriendlyName === 'function' && withdrawCascadeDetails.targetPool.qualifyingUserTokens.length > 0 ? 
                   lucidInstance.utils.assetsToFriendlyName({[withdrawCascadeDetails.targetPool.qualifyingUserTokens[0].unit]: withdrawCascadeDetails.targetPool.qualifyingUserTokens[0].amount || 0n}) : 
                   withdrawCascadeDetails.targetPool.qualifyingUserTokens[0].unit}
                  </span> (currently at Index {
                    // Display the index derived from chosenTokenForWithdrawal for consistency
                    chosenTokenForWithdrawal?.tokenIndex ?? 'N/A'
                  }):
                </p>
              )}
              <ul className="list-disc pl-5 space-y-1 mb-6 max-h-40 overflow-y-auto">
                {withdrawCascadeDetails.intermediatePools.map(pool => (
                  <li key={pool.index} className="text-sm text-black">{pool.name} (Index: {pool.index})</li>
                ))}
              </ul>
              <p className="text-sm text-black mb-6">
                Your token's index will be updated to {withdrawCascadeDetails.targetPool.index + 1} after this operation.
              </p>
              <div className="flex justify-end space-x-3">
                <motion.button onClick={handleCancelCascadeWithdraw} /* ... */ disabled={isProcessingWithdrawal}>Cancel</motion.button>
                <motion.button 
                  onClick={handleConfirmCascadeWithdraw} 
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors flex items-center justify-center space-x-2 disabled:bg-primary-400"
                  disabled={isProcessingWithdrawal}
                >
                  {isProcessingWithdrawal ? (
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  ) : null}
                  <span>{isProcessingWithdrawal ? 'Processing...' : 'Confirm & Withdraw All'}</span>
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Token Selector Modal */}
      <AnimatePresence>
        {showTokenSelectorModal && poolForTokenSelection && (
          <motion.div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[120]"
            onClick={() => { setShowTokenSelectorModal(false); setPoolForTokenSelection(null); }}
          >
            <motion.div 
              className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 w-full max-w-md"
              onClick={(e) => e.stopPropagation()} // Prevent click through
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <h2 className="text-xl font-bold mb-4 text-black">Select Token for {poolForTokenSelection.name}</h2>
              {poolForTokenSelection.qualifyingUserTokens.length > 0 ? (
                <ul className="list-none pl-0 space-y-3 max-h-60 overflow-y-auto pr-2">
                  {poolForTokenSelection.qualifyingUserTokens.map((token) => (
                    <li key={token.unit} className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">
                      <div className="font-semibold text-black mb-1">Amount: {token.amount.toString()}</div>
                      <div className="text-black truncate mb-1 text-sm">
                        Name: {lucidInstance?.utils?.assetsToFriendlyName?.({[token.unit]: token.amount}) || token.unit}
                      </div>
                      <div className="text-black mb-2 text-sm">(Token Index: {token.tokenIndex})</div>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => initiateWithdrawalProcess(String(poolForTokenSelection.index), token)}
                        className="w-full py-2 px-3 text-sm rounded-md font-medium bg-primary-500 text-white hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-1 transition-all duration-200"
                      >
                        Withdraw with this Token (Index {token.tokenIndex})
                      </motion.button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-black text-center">No tokens available for selection.</p>
              )}
              <button 
                onClick={() => { setShowTokenSelectorModal(false); setPoolForTokenSelection(null); }}
                className="mt-6 w-full py-2 px-4 text-sm font-medium text-black bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
} 