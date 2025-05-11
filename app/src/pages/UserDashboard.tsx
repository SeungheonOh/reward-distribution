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
  lucidInstance: Lucid | null;
  appNetwork?: LucidNetwork | null;
}

interface AssetHoldings { 
  [unit: string]: bigint; 
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

interface DisplayableRewardPool extends RewardPoolConfig {
  userTokenAmount: bigint | null;
  userTokenUnit: string | null;
  qualifyingUserTokenIndex?: number | null;
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
  const [userEquityHoldings, setUserEquityHoldings] = useState<AssetHoldings>({});
  
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
    if (!lucidInstance || !policyId || !rewardConfigsMap || Object.keys(userEquityHoldings).length === 0) {
      setDisplayablePools([]);
      return;
    }

    const currentEquityPoolConfigs = rewardConfigsMap[policyId];
    if (!currentEquityPoolConfigs || currentEquityPoolConfigs.length === 0) {
      setDisplayablePools([]);
      return;
    }

    const newDisplayablePools = currentEquityPoolConfigs.map(config => {
      let bestMatch = {
        userTokenAmount: null as bigint | null,
        userTokenUnit: null as string | null,
        qualifyingUserTokenIndex: -1 as number
      };

      for (const [unit, amount] of Object.entries(userEquityHoldings)) {
        if (unit.startsWith(policyId)) { 
          const friendlyName = typeof lucidInstance.utils?.assetsToFriendlyName === 'function'
            ? lucidInstance.utils.assetsToFriendlyName({ [unit]: amount })
            : unit;
          const userTokenIdx = getIndexFromFriendlyName(friendlyName);
          
          if (userTokenIdx !== null && userTokenIdx <= config.index) {
            if (userTokenIdx > bestMatch.qualifyingUserTokenIndex) {
              bestMatch = {
                userTokenAmount: amount,
                userTokenUnit: unit,
                qualifyingUserTokenIndex: userTokenIdx
              };
            }
          }
        }
      }
      return {
         ...config,
         userTokenAmount: bestMatch.userTokenAmount,
         userTokenUnit: bestMatch.userTokenUnit,
         qualifyingUserTokenIndex: bestMatch.qualifyingUserTokenIndex !== -1 ? bestMatch.qualifyingUserTokenIndex : null
      };
    });
    setDisplayablePools(newDisplayablePools);

  }, [lucidInstance, policyId, rewardConfigsMap, userEquityHoldings]);

  const handleReferenceInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setReferenceScriptInput(e.target.value);
    setReferenceError(null);
  };

  const handleSetReferenceScript = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setReferenceError(null);
    setIsLoadingReference(true);
    setUserEquityHoldings({});
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
      const holdings: AssetHoldings = walletUtxos
        .map((utxo: LucidUTxO) => {
          return Object.fromEntries(
            Object.entries(utxo.assets).filter(([assetUnit, _quantity]: [string, bigint]) => {
               return assetUnit.startsWith(calculatedPolicyId) 
             }
            )
          ) as AssetHoldings;
        })
        .reduce((acc: AssetHoldings, currentHoldings: AssetHoldings) => {
          for (const unit in currentHoldings) {
            acc[unit] = (acc[unit] || 0n) + currentHoldings[unit];
          }
          return acc;
        }, {} as AssetHoldings);
      
      setUserEquityHoldings(holdings);
      console.log('User Equity Holdings for this policy:', holdings);
      console.log(`Fetched reference: ${txHash}#${outputIndex}`);
      console.log(`Policy ID loaded: ${calculatedPolicyId}`);
      setReferenceUtxo({ txHash, outputIndex });
      setIsReferenceScriptSet(true);
    } catch (err) {
      console.error("Error fetching or processing reference UTXO:", err);
      setReferenceError(`Failed to load script: ${err instanceof Error ? err.message : String(err)}`);
      setPolicyId(null);
    } finally {
      setIsLoadingReference(false);
    }
  };

  const initiateWithdrawalProcess = (targetPoolConfigIndex: string) => {
    const targetPool = displayablePools.find(p => String(p.index) === targetPoolConfigIndex);
    if (!targetPool || targetPool.userTokenAmount === null || targetPool.userTokenAmount === 0n || typeof targetPool.qualifyingUserTokenIndex !== 'number') {
      console.error("Cannot initiate withdrawal: Target pool or qualifying token info is invalid.");
      return;
    }
    setSelectedPool(targetPoolConfigIndex);
    setWithdrawAmount('');
  };

  const mapPoolToWithdrawalParams = (pool: DisplayableRewardPool): WithdrawalPoolParams => ({
    name: pool.name,
    index: pool.index,
    userTokenUnit: pool.userTokenUnit,
    qualifyingUserTokenIndex: pool.qualifyingUserTokenIndex === undefined ? null : pool.qualifyingUserTokenIndex,
    userTokenAmount: pool.userTokenAmount,
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
        return;
    }
    const targetPool = displayablePools.find(p => String(p.index) === selectedPool);
    if (!targetPool || targetPool.userTokenAmount === null || typeof targetPool.qualifyingUserTokenIndex !== 'number') {
      console.error("Error in confirm: Target pool or qualifying token info is invalid.");
      setSelectedPool(null); 
      return;
    }

    const userTokenCurrentIdx = targetPool.qualifyingUserTokenIndex;
    const intermediatePoolsToProcess = displayablePools.filter(p => 
      p.index >= userTokenCurrentIdx && 
      p.index < targetPool.index && 
      p.status === 'active' &&
      p.userTokenUnit === targetPool.userTokenUnit &&
      p.userTokenAmount !== null && p.userTokenAmount > 0n
    ).sort((a, b) => a.index - b.index);

    const currentWithdrawAmount = withdrawAmount;
    setSelectedPool(null); 

    if (intermediatePoolsToProcess.length > 0) {
      setWithdrawCascadeDetails({ 
        targetPool: targetPool,
        intermediatePools: intermediatePoolsToProcess, 
        amountForTargetPool: currentWithdrawAmount 
      });
      setShowWithdrawCascadeModal(true);
    } else {
      setIsProcessingWithdrawal(true);
      setWithdrawalTxHash(null);
      setWithdrawalError(null);
      try {
        const txResult = await processWithdrawal({
            lucid: lucidInstance,
            targetPool: mapPoolToWithdrawalParams(targetPool),
            intermediatePools: [],
            amount: currentWithdrawAmount
        } as ProcessWithdrawalArgs);
        setWithdrawalTxHash(txResult);
      } catch (error) {
        setWithdrawalError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsProcessingWithdrawal(false);
        setWithdrawAmount(''); 
      }
    }
  };

  const handleConfirmCascadeWithdraw = async () => {
    if (withdrawCascadeDetails && lucidInstance) {
      setIsProcessingWithdrawal(true);
      setWithdrawalTxHash(null);
      setWithdrawalError(null);
      try {
        const txResult = await processWithdrawal({
            lucid: lucidInstance,
            targetPool: mapPoolToWithdrawalParams(withdrawCascadeDetails.targetPool),
            intermediatePools: withdrawCascadeDetails.intermediatePools.map(mapPoolToWithdrawalParams),
            amount: withdrawCascadeDetails.amountForTargetPool
        } as ProcessWithdrawalArgs);
        setWithdrawalTxHash(txResult);
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
  };

  if (!isReferenceScriptSet) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-md shadow-soft rounded-xl p-6 sm:p-8 w-full max-w-lg text-center"
        >
          <h2 className="text-2xl font-bold mb-6 text-gray-800">Set Equity Token Reference</h2>
          <p className="text-gray-600 mb-6 text-sm">
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
        <p className="text-gray-700">
          Equity Token Script Reference:
          <span className="font-mono bg-gray-100 p-1 rounded text-primary-600">
            {referenceUtxo?.txHash}#{referenceUtxo?.outputIndex}
          </span>
        </p>
        {policyId && (
          <p className="text-gray-500 text-xs mt-1">
            Policy ID: <span className="font-mono bg-gray-100 p-1 rounded">{policyId}</span>
          </p>
        )}
        {Object.keys(userEquityHoldings).length > 0 && lucidInstance && (
          <div className="mt-4">
            <h3 className="text-md font-semibold text-gray-800 mb-2">Your Equity Token Holdings (All under this Policy ID):</h3>
            <ul className="list-disc pl-5 space-y-1">
              {Object.entries(userEquityHoldings).map(([unit, amount]) => (
                <li key={unit} className="text-xs text-gray-600">
                  <span className="font-mono bg-gray-100 p-0.5 rounded">
                    {(typeof lucidInstance.utils?.assetsToFriendlyName === 'function' ? 
                      lucidInstance.utils.assetsToFriendlyName({[unit]: amount}) : unit)}
                  </span>: 
                  <span className="font-semibold"> {amount.toString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-md shadow-soft rounded-xl p-6"
      >
        <h2 className="text-2xl font-bold mb-6">
          Available Reward Pools for current Equity Token
        </h2>
        {isLoadingConfigs && <p className="text-gray-500">Loading reward pool configurations...</p>}
        {configError && <p className="text-red-500">Error loading configurations: {configError}</p>}
        
        {!isLoadingConfigs && !configError && policyId && !rewardConfigsMap?.[policyId] && (
            <p className="text-gray-600 text-center py-4">No reward pool configurations found for the loaded equity token policy ID ({policyId}).</p>
        )}
        {!isLoadingConfigs && !configError && policyId && rewardConfigsMap?.[policyId] && displayablePools.length === 0 && (
            <p className="text-gray-600 text-center py-4">No reward pools available for your tokens under policy ID {policyId}, or no matching equity tokens found for configured pools.</p>
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
                    <h3 className="text-lg font-semibold text-gray-900">{pool.name} (Index: {pool.index})</h3>
                    <span className={`px-3 py-1 text-xs font-medium rounded-full ${pool.status === 'active' 
                        ? 'bg-green-100 text-green-800' 
                        : pool.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {pool.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">{pool.description}</p>
                  
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-sm text-gray-500 mb-1">Your Qualifying Token</p>
                      <p className="text-xl font-bold text-primary-600">
                        {pool.userTokenAmount !== null ? pool.userTokenAmount.toString() : 'N/A'}
                      </p>
                      {pool.userTokenUnit && lucidInstance && (
                        <p className="text-xs text-gray-500 truncate">
                          (Name: {typeof lucidInstance.utils?.assetsToFriendlyName === 'function' ? lucidInstance.utils.assetsToFriendlyName({[pool.userTokenUnit]: pool.userTokenAmount || 0n}) : pool.userTokenUnit})
                          {pool.qualifyingUserTokenIndex !== null && ` (Index: ${pool.qualifyingUserTokenIndex})`}
                        </p>
                      )}
                      {pool.userTokenAmount === null && (
                          <p className="text-xs text-gray-500">No token you hold qualifies for this pool.</p>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-sm text-gray-500 mb-1">Total in Pool</p>
                      <p className="text-xl font-bold text-gray-900">{pool.totalAmountInPool}</p>
                    </div>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => initiateWithdrawalProcess(String(pool.index))}
                    disabled={pool.status !== 'active' || pool.userTokenAmount === null || pool.userTokenAmount === 0n}
                    className={`w-full py-3 px-4 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200 ${
                        (pool.status !== 'active' || pool.userTokenAmount === null || pool.userTokenAmount === 0n) 
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-primary-600 to-secondary-600 text-black hover:from-primary-700 hover:to-secondary-700'
                    }`}
                  >
                    Withdraw from Pool (Index {pool.index})
                  </motion.button>
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
              <motion.div /* Modal container */ onClick={() => {setSelectedPool(null); setWithdrawAmount('');}} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]">
                <motion.div /* Modal content */ onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 w-full max-w-md">
                  <h2 className="text-2xl font-bold mb-6">Withdraw from {currentPoolForModal.name}</h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Please enter the amount you wish to withdraw from this pool. If other prerequisite pools need to be processed, you will be asked to confirm.
                  </p>
                  <div>
                     <label htmlFor="withdraw-amount" className="block text-sm font-medium text-gray-700">Amount to Withdraw</label>
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
                      onClick={() => {setSelectedPool(null); setWithdrawAmount('');}} 
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
              <h2 className="text-xl font-bold mb-4 text-gray-800">Confirm Cascading Withdrawal</h2>
              <p className="text-sm text-gray-600 mb-2">
You are targeting withdrawal from <span className="font-semibold">{withdrawCascadeDetails.targetPool.name} (Index: {withdrawCascadeDetails.targetPool.index})</span>.
              {withdrawCascadeDetails.amountForTargetPool && parseFloat(withdrawCascadeDetails.amountForTargetPool) > 0 && (
                <span> You specified an amount of <span className="font-semibold">{withdrawCascadeDetails.amountForTargetPool}</span> for this target pool.</span>
              )}
              </p>
              {withdrawCascadeDetails.intermediatePools.length > 0 && (
                <p className="text-sm text-gray-600 mb-4">
                  This action will also process withdrawals from the following prerequisite pool(s) using your token 
                  <span className="font-mono text-xs bg-gray-100 p-0.5 rounded">{typeof lucidInstance?.utils?.assetsToFriendlyName === 'function' && withdrawCascadeDetails.targetPool.userTokenUnit ? 
                   lucidInstance.utils.assetsToFriendlyName({[withdrawCascadeDetails.targetPool.userTokenUnit]: withdrawCascadeDetails.targetPool.userTokenAmount || 0n}) : 
                   withdrawCascadeDetails.targetPool.userTokenUnit}
                  </span> (currently at Index {withdrawCascadeDetails.targetPool.qualifyingUserTokenIndex}):
                </p>
              )}
              <ul className="list-disc pl-5 space-y-1 mb-6 max-h-40 overflow-y-auto">
                {withdrawCascadeDetails.intermediatePools.map(pool => (
                  <li key={pool.index} className="text-sm text-gray-500">{pool.name} (Index: {pool.index})</li>
                ))}
              </ul>
              <p className="text-sm text-gray-600 mb-6">
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
    </div>
  );
} 