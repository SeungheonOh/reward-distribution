import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { type Lucid, type Network as LucidNetwork } from '@lucid-evolution/lucid'; // Import LucidNetwork
import { mintEquityTokens } from '../utils/mintEquityTransaction'; // Updated import path
import { createRewardPoolTransaction } from '../utils/createRewardPoolTransaction'; // Import for creating reward pools

interface RewardPool {
  id: string;
  poolId: number;
  name: string;
  totalAmount: number;
  distributedAmount: number;
  status: 'active' | 'completed';
  equityTokenReference?: string; // Added new optional field
}

interface AdminDashboardProps {
  lucidInstance: any;
  walletAddress: string | null;
  appNetwork: LucidNetwork | null; // Add appNetwork prop
}

export default function AdminDashboard({ lucidInstance, walletAddress, appNetwork }: AdminDashboardProps) {
  const [rewardPools, setRewardPools] = useState<RewardPool[]>([]);
  const [newPoolIdInput, setNewPoolIdInput] = useState('');
  const [newPoolAmount, setNewPoolAmount] = useState('');
  const [newPoolEquityRef, setNewPoolEquityRef] = useState('');
  const [newPoolConfigName, setNewPoolConfigName] = useState('');
  const [newPoolConfigDescription, setNewPoolConfigDescription] = useState('');

  // State for new pool creation UI (similar to minting)
  const [isCreatingPool, setIsCreatingPool] = useState(false);
  const [poolCreationTxHash, setPoolCreationTxHash] = useState<string | null>(null);
  const [poolCreationError, setPoolCreationError] = useState<string | null>(null);

  // State for new token minting
  const [mintTokenName, setMintTokenName] = useState('');
  const [mintTokenAmount, setMintTokenAmount] = useState('');
  const [isMinting, setIsMinting] = useState(false);
  const [mintingTxHash, setMintingTxHash] = useState<string | null>(null);
  const [mintingError, setMintingError] = useState<string | null>(null);

  const getCardanoscanBaseUrl = () => {
    if (!appNetwork) return 'https://cardanoscan.io'; // Default or handle error
    switch (appNetwork) {
      case 'Mainnet':
        return 'https://cardanoscan.io';
      case 'Preprod':
        return 'https://preprod.cardanoscan.io';
      case 'Preview':
        return 'https://preview.cardanoscan.io';
      // Add other networks if lucid/cardanoscan supports them (e.g., 'Testnet')
      default:
        // For custom networks or unhandled cases, maybe default to mainnet or a generic explorer
        // Or, if APP_NETWORK can be other strings like "Sanchonet", "Custom", etc.
        // we might need a more robust mapping or simply don't show the link if network is unknown.
        console.warn(`Unknown network for Cardanoscan: ${appNetwork}`);
        return `https://cardanoscan.io`; // Fallback
    }
  };

  const createNewPool = async () => {
    if (!lucidInstance) {
      setPoolCreationError('Lucid instance is not available. Please connect wallet.');
      return;
    }
    if (!walletAddress) {
      setPoolCreationError('Wallet address is not available.');
      return;
    }
    if (!newPoolIdInput.trim() || !newPoolAmount.trim() || !newPoolEquityRef.trim() || !newPoolConfigName.trim() || !newPoolConfigDescription.trim()) {
      setPoolCreationError('Please fill in all fields for the reward pool, including config details (script reference will be auto-generated).');
      return;
    }

    const poolId = parseInt(newPoolIdInput.trim(), 10);
    if (isNaN(poolId) || poolId < 0) {
      setPoolCreationError('Please enter a valid non-negative Pool ID.');
      return;
    }

    const amount = parseFloat(newPoolAmount);
    if (isNaN(amount) || amount <= 0) {
      setPoolCreationError('Please enter a valid total amount for the pool.');
      return;
    }

    // Parse equityTokenReferenceInput (TxHash#Index)
    const equityRefParts = newPoolEquityRef.trim().split('#');
    if (equityRefParts.length !== 2 || !equityRefParts[0] || isNaN(parseInt(equityRefParts[1], 10)) || parseInt(equityRefParts[1], 10) < 0) {
      setPoolCreationError('Equity Token Reference Input must be in the format TxHash#Index (e.g., abcdef123#0).');
      return;
    }
    const equityTokenTxHash = equityRefParts[0];
    const equityTokenOutputIndex = parseInt(equityRefParts[1], 10);

    setIsCreatingPool(true);
    setPoolCreationTxHash(null);
    setPoolCreationError(null);

    try {
      // Call the actual transaction function, now returns an object
      const { txHash, poolScriptReference } = await createRewardPoolTransaction({
        lucid: lucidInstance,
        poolId: poolId,
        poolDescription: newPoolConfigDescription.trim(),
        totalAmountInPool: amount,
        equityTokenTxHash: equityTokenTxHash,
        equityTokenOutputIndex: equityTokenOutputIndex,
        walletAddress: walletAddress,
      });

      setPoolCreationTxHash(txHash);
      
      const newPool: RewardPool = {
        id: txHash,
        poolId: poolId,
        name: newPoolConfigName.trim(),
        totalAmount: amount,
        distributedAmount: 0,
        status: 'active',
        equityTokenReference: newPoolEquityRef.trim(),
      };
      setRewardPools(prevPools => [...prevPools, newPool]);
      setNewPoolIdInput('');
      setNewPoolAmount('');
      setNewPoolEquityRef('');
      setNewPoolConfigName('');
      setNewPoolConfigDescription('');

      // Log the JSON for rewardPoolsConfig.json
      const poolConfigEntry = {
        index: poolId,
        name: newPoolConfigName.trim(),
        description: newPoolConfigDescription.trim(),
        poolScriptReference: poolScriptReference,
        totalAmountInPool: amount,
        status: "active"
      };
      console.log("--- New Reward Pool Config Entry (Copy and add to public/rewardPoolsConfig.json under the correct Policy ID) ---");
      console.log(JSON.stringify(poolConfigEntry, null, 2));
      console.log("-----------------------------------------------------------------------------------------------------------------");

    } catch (error) {
      console.error('Failed to create reward pool:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setPoolCreationError(`Pool creation failed: ${errorMessage}`);
    } finally {
      setIsCreatingPool(false);
    }
  };

  const handleMintTokens = async () => {
    if (!lucidInstance) {
      setMintingError('Lucid instance is not available. Please connect wallet.');
      return;
    }
    if (!walletAddress) {
      setMintingError('Wallet address is not available.');
      return;
    }
    const amount = parseInt(mintTokenAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      setMintingError('Please enter a valid amount for the tokens.');
      return;
    }
    if (!mintTokenName.trim()) {
      setMintingError('Please enter a name for the tokens.');
      return;
    }

    setIsMinting(true);
    setMintingTxHash(null);
    setMintingError(null);

    try {
      const txHash = await mintEquityTokens({
        lucid: lucidInstance,
        amount: amount,
        tokenName: mintTokenName.trim(),
        walletAddress: walletAddress,
      });
      setMintingTxHash(txHash);
      setMintTokenName('');
      setMintTokenAmount('');
    } catch (error) {
      console.error('Failed to mint tokens:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setMintingError(`Token minting failed: ${errorMessage}`);
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-md shadow-soft rounded-xl p-6"
      >
        <h2 className="text-2xl font-bold mb-6">
          Create New Reward Pool
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="pool-id" className="block text-sm font-medium text-gray-700">
              Pool ID
            </label>
            <input
              type="number"
              id="pool-id"
              value={newPoolIdInput}
              onChange={(e) => setNewPoolIdInput(e.target.value)}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200"
              placeholder="Enter numeric Pool ID..."
              disabled={isCreatingPool}
            />
          </div>
          <div>
            <label htmlFor="pool-config-name" className="block text-sm font-medium text-gray-700">
              Config Pool Name
            </label>
            <input
              type="text"
              id="pool-config-name"
              value={newPoolConfigName}
              onChange={(e) => setNewPoolConfigName(e.target.value)}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200"
              placeholder="Enter name for rewardPoolsConfig.json (e.g., Q1 Staking)"
              disabled={isCreatingPool}
            />
          </div>
          <div>
            <label htmlFor="pool-config-description" className="block text-sm font-medium text-gray-700">
              Config Pool Description
            </label>
            <input
              type="text"
              id="pool-config-description"
              value={newPoolConfigDescription}
              onChange={(e) => setNewPoolConfigDescription(e.target.value)}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200"
              placeholder="Enter description for rewardPoolsConfig.json"
              disabled={isCreatingPool}
            />
          </div>
          <div>
            <label htmlFor="pool-amount" className="block text-sm font-medium text-gray-700">
              Total Amount
            </label>
            <input
              type="number"
              id="pool-amount"
              value={newPoolAmount}
              onChange={(e) => setNewPoolAmount(e.target.value)}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200"
              placeholder="Enter total amount..."
            />
          </div>
          <div>
            <label htmlFor="pool-equity-ref" className="block text-sm font-medium text-gray-700">
              Equity Token Reference Input (TxHash#Index)
            </label>
            <input
              type="text"
              id="pool-equity-ref"
              value={newPoolEquityRef}
              onChange={(e) => {
                setNewPoolEquityRef(e.target.value);
                setPoolCreationTxHash(null); // Clear messages on input change
                setPoolCreationError(null);
              }}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200"
              placeholder="Enter TxHash#Index of the equity token reference script"
              disabled={isCreatingPool}
            />
          </div>
          <motion.button
            whileHover={{ scale: !isCreatingPool ? 1.02 : 1 }}
            whileTap={{ scale: !isCreatingPool ? 0.98 : 1 }}
            onClick={createNewPool}
            disabled={isCreatingPool || !lucidInstance}
            className={`w-full py-3 px-4 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200 flex items-center justify-center space-x-2 ${isCreatingPool || !lucidInstance ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-primary-600 to-secondary-600 text-white hover:from-primary-700 hover:to-secondary-700'}`}
          >
            {isCreatingPool && (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            <span>{isCreatingPool ? 'Creating Pool...' : 'Create Pool'}</span>
          </motion.button>

          <AnimatePresence>
            {isCreatingPool && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-sm text-center text-blue-600 mt-2"
              >
                Processing transaction on the blockchain...
              </motion.div>
            )}
          </AnimatePresence>
          
          <AnimatePresence>
            {poolCreationTxHash && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-center"
              >
                <p className="text-sm font-medium text-green-700">Reward Pool Created Successfully!</p>
                <p className="text-xs text-green-600 mt-1 truncate">Tx: {poolCreationTxHash}</p>
                 {appNetwork && poolCreationTxHash && (
                    <a 
                      href={`${getCardanoscanBaseUrl()}/transaction/${poolCreationTxHash}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline mt-1"
                    >
                      View on Cardanoscan ({appNetwork})
                    </a>
                 )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {poolCreationError && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-center"
              >
                <p className="text-sm font-medium text-red-700">Error</p>
                <p className="text-xs text-red-600 mt-1">{poolCreationError}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {!lucidInstance && !isCreatingPool && (
            <p className="text-xs text-red-500 text-center">Please connect your wallet to create a pool.</p>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-md shadow-soft rounded-xl p-6"
      >
        <h2 className="text-2xl font-bold mb-6">
          Mint Equity Tokens
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="token-name" className="block text-sm font-medium text-gray-700">
              Token Name
            </label>
            <input
              type="text"
              id="token-name"
              value={mintTokenName}
              onChange={(e) => {
                setMintTokenName(e.target.value);
                setMintingTxHash(null); // Clear messages on input change
                setMintingError(null);
              }}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200"
              placeholder="Enter token name (e.g., MyEquityToken)"
              disabled={isMinting}
            />
          </div>
          <div>
            <label htmlFor="token-amount" className="block text-sm font-medium text-gray-700">
              Amount to Mint
            </label>
            <input
              type="number"
              id="token-amount"
              value={mintTokenAmount}
              onChange={(e) => {
                setMintTokenAmount(e.target.value);
                setMintingTxHash(null); // Clear messages on input change
                setMintingError(null);
              }}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm transition-colors duration-200"
              placeholder="Enter amount to mint..."
              disabled={isMinting}
            />
          </div>
          <motion.button
            whileHover={{ scale: !isMinting ? 1.02 : 1 }}
            whileTap={{ scale: !isMinting ? 0.98 : 1 }}
            onClick={handleMintTokens}
            disabled={isMinting || !lucidInstance}
            className={`w-full py-3 px-4 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200 flex items-center justify-center space-x-2 ${
              isMinting || !lucidInstance
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700'
            }`}
          >
            {isMinting && (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            <span>{isMinting ? 'Minting...' : 'Mint Tokens'}</span>
          </motion.button>

          <AnimatePresence>
            {isMinting && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-sm text-center text-blue-600 mt-2"
              >
                Processing transaction on the blockchain...
              </motion.div>
            )}
          </AnimatePresence>
          
          <AnimatePresence>
            {mintingTxHash && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-center"
              >
                <p className="text-sm font-medium text-green-700">Tokens Minted Successfully!</p>
                <p className="text-xs text-green-600 mt-1 truncate">Tx: {mintingTxHash}</p>
                 {appNetwork && mintingTxHash && (
                    <a 
                      href={`${getCardanoscanBaseUrl()}/transaction/${mintingTxHash}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline mt-1"
                    >
                      View on Cardanoscan ({appNetwork})
                    </a>
                 )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {mintingError && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-center"
              >
                <p className="text-sm font-medium text-red-700">Error</p>
                <p className="text-xs text-red-600 mt-1">{mintingError}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {!lucidInstance && !isMinting && (
            <p className="text-xs text-red-500 text-center">Please connect your wallet to mint tokens.</p>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-md shadow-soft rounded-xl p-6"
      >
        <h2 className="text-2xl font-bold mb-6">
          Active Reward Pools
        </h2>
        <div className="space-y-4">
          {rewardPools.map((pool) => (
            <motion.div
              key={pool.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-xl shadow-soft hover:shadow-lg transition-all duration-300 p-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{pool.name} (ID: {pool.poolId})</h3>
                <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                  pool.status === 'active' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {pool.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-500 mb-1">Total Amount</p>
                  <p className="text-xl font-bold text-gray-900">{pool.totalAmount}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-500 mb-1">Distributed</p>
                  <p className="text-xl font-bold text-primary-600">{pool.distributedAmount}</p>
                </div>
              </div>
              {pool.equityTokenReference && (
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <p className="text-sm text-gray-500 mb-1">Equity Token Reference</p>
                  <p className="text-xs font-mono text-gray-700 break-all">{pool.equityTokenReference}</p>
                </div>
              )}
              <div className="flex space-x-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  // onClick={() => handleDistributeRewards(pool.id)}
                  className="flex-1 py-2 px-4 bg-gradient-to-r from-primary-600 to-secondary-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-secondary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200"
                >
                  Distribute Rewards
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  // onClick={() => handleClosePool(pool.id)}
                  className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200"
                >
                  Close Pool
                </motion.button>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
} 