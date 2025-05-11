import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import AdminDashboard from './pages/AdminDashboard';
import UserDashboard from './pages/UserDashboard';
import { motion, AnimatePresence } from 'framer-motion';
// import { Lucid, Maestro } from '@lucid-evolution/lucid';
import { type WalletApi, type Network as LucidNetwork, type Lucid } from '@lucid-evolution/lucid';

// CIP-30 types (basic)
// interface CardanoWalletApi {
//   enable: () => Promise<any>; 
//   experimental: {
//     getCollateral: () => Promise<string[]>; 
//   };
//   getBalance: () => Promise<string>; 
//   getUsedAddresses: () => Promise<string[]>; 
//   // ... other CIP-30 methods
// }
// Use Lucid's WalletApi type instead

// Simplified window.cardano declaration to avoid conflicts
declare global {
  interface Window {
    cardano?: {
      [key: string]: {
        name: string;
        icon: string;
        apiVersion: string;
        enable: () => Promise<WalletApi | null>;
        isEnabled: () => Promise<boolean>;
      }
    };
  }
}

const MAESTRO_API_KEY = import.meta.env.VITE_MAESTRO_API_KEY || 'YOUR_MAESTRO_API_KEY_HERE_FALLBACK';
const APP_NETWORK: LucidNetwork = import.meta.env.VITE_APP_NETWORK as LucidNetwork;

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      className={`relative px-4 py-2 text-sm font-medium transition-colors duration-200 ${
        isActive ? 'text-primary-600' : 'text-gray-500 hover:text-primary-500'
      }`}
    >
      {children}
      {isActive && (
        <motion.div
          layoutId="nav-underline"
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600"
          initial={false}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      )}
    </Link>
  );
}

function App() {
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<string[]>([]);
  const [connectedWalletName, setConnectedWalletName] = useState<string | null>(null);
  const [lucidInstance, setLucidInstance] = useState<Lucid | null>(null);

  const detectWallets = () => {
    if (window.cardano) {
      const detected = Object.keys(window.cardano).filter(
        (walletKey) => {
          const wallet = window.cardano![walletKey];
          return wallet && typeof wallet.enable === 'function' && typeof wallet.name === 'string' && typeof wallet.apiVersion === 'string' && typeof wallet.icon === 'string';
        }
      );
      setAvailableWallets(detected);
      return detected;
    }
    return [];
  };

  useEffect(() => {
    const wallets = detectWallets();
    // Optional: Check localStorage for a previously connected wallet and try to reconnect silently
    // For now, just detect and prompt if none connected
    const previouslyConnected = localStorage.getItem('connectedWalletName');
    if (previouslyConnected && wallets.includes(previouslyConnected)) {
      connectWallet(previouslyConnected, true); // Try to reconnect silently
    } else if (wallets.length > 0 && !isWalletConnected) {
       // setShowConnectModal(true); // Auto-show modal if wallets available and not connected
                                 // User requested modal on first load, this handles it.
    }
  }, []);

  useEffect(() => {
    // Automatically show modal if wallets are detected and none is connected
    // This addresses the "prompt modal when user first loads the page"
    if (availableWallets.length > 0 && !isWalletConnected && !localStorage.getItem('connectedWalletName')) {
      setShowConnectModal(true);
    }
  }, [availableWallets, isWalletConnected]);

  const initializeLucid = async (walletName: string, walletApi: WalletApi) => {
    if (!MAESTRO_API_KEY || MAESTRO_API_KEY === 'YOUR_MAESTRO_API_KEY_HERE_FALLBACK') {
      alert('Maestro API key is not set. Please configure it in a .env file (VITE_MAESTRO_API_KEY) or update the fallback in src/App.tsx.');
      console.error('Maestro API key is not set properly.');
      return;
    }
    try {
      const { Lucid: LucidValue, Maestro } = await import('@lucid-evolution/lucid');

      const maestroProvider = new Maestro({
        network: APP_NETWORK as "Mainnet" | "Preprod" | "Preview",
        apiKey: MAESTRO_API_KEY,
        turboSubmit: false 
      });
      console.log(APP_NETWORK)

      const lucid = await LucidValue(
        maestroProvider,
        APP_NETWORK
      );

      lucid.selectWallet.fromAPI(walletApi);

      setLucidInstance(lucid);
      console.log(`Lucid initialized with ${walletName} on ${APP_NETWORK}`);
      const addr = await lucid.wallet().address();
      setWalletAddress(addr);

    } catch (error) {
      console.error(`Error initializing Lucid with ${walletName}:`, error);
      alert(`Could not initialize Lucid. Check console for details.`);
      setIsWalletConnected(false);
      setWalletAddress(null);
      setConnectedWalletName(null);
      localStorage.removeItem('connectedWalletName');
      setLucidInstance(null);
    }
  };

  const connectWallet = async (walletName: string, isReconnect: boolean = false) => {
    if (window.cardano && window.cardano[walletName]) {
      try {
        const walletApi = await window.cardano[walletName].enable();
        if (walletApi) {
          setIsWalletConnected(true);
          setConnectedWalletName(walletName);
          localStorage.setItem('connectedWalletName', walletName);
          setShowConnectModal(false);
          console.log(`${walletName} connected, API version: ${window.cardano[walletName].apiVersion}`);
          await initializeLucid(walletName, walletApi);
        } else {
           console.error("Failed to enable wallet API.");
           if (!isReconnect) alert("Failed to connect to wallet. The wallet API could not be enabled.");
        }
      } catch (error) {
        console.error(`Error connecting to ${walletName}:`, error);
        if (!isReconnect) alert(`Error connecting to ${walletName}. See console for details.`);
        if (isReconnect) {
            localStorage.removeItem('connectedWalletName');
        }
      }
    } else {
      if (!isReconnect) alert("Selected wallet is not available. Please ensure the extension is installed and active.");
    }
  };

  const disconnectWallet = () => {
    setIsWalletConnected(false);
    setWalletAddress(null);
    setConnectedWalletName(null);
    setLucidInstance(null);
    localStorage.removeItem('connectedWalletName');
    console.log("Wallet and Lucid instance disconnected.");
  };

  const shortenAddress = (address: string | null): string => {
    if (!address) return "";
    if (address.length < 20) return address; // Already short or not a typical address
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  return (
    <Router>
      <div className="min-h-screen w-full bg-gradient-to-br from-primary-50 to-secondary-50">
        <nav className="bg-white/80 backdrop-blur-md shadow-soft sticky top-0 z-50 w-full">
          <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5 }}
                  className="flex-shrink-0 flex items-center"
                >
                  <h1 className="text-2xl font-bold px-4 py-2 text-gray-900">
                    Reward Distribution
                  </h1>
                </motion.div>
                <div className="hidden sm:ml-10 sm:flex sm:space-x-4">
                  <NavLink to="/admin">Admin</NavLink>
                  <NavLink to="/user">User</NavLink>
                </div>
              </div>
              {/* Wallet Connect Button Area */}
              <div className="flex items-center">
                {isWalletConnected && walletAddress ? (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-700 bg-gray-200 px-3 py-1.5 rounded-lg">
                      {shortenAddress(walletAddress)}
                    </span>
                    <button
                      onClick={disconnectWallet}
                      className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-800 bg-red-100 hover:bg-red-200 rounded-lg transition-colors duration-200"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                        detectWallets();
                        setShowConnectModal(true);
                    }}
                    className="px-4 py-2 text-sm font-medium text-black bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                  >
                    Connect Wallet
                  </button>
                )}
              </div>
            </div>
          </div>
        </nav>

        <main className="w-full px-4 sm:px-6 lg:px-8 py-6">
          <AnimatePresence mode="wait">
            <Routes>
              <Route path="/admin" element={
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <AdminDashboard 
                    lucidInstance={lucidInstance} 
                    walletAddress={walletAddress} 
                    appNetwork={APP_NETWORK}
                  /> 
                </motion.div>
              } />
              <Route path="/user" element={
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <UserDashboard lucidInstance={lucidInstance} />
                </motion.div>
              } />
              <Route path="/" element={
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-center py-12"
                >
                  <h2 className="text-4xl font-bold mb-4 text-gray-900">
                    Welcome to Reward Distribution System
                  </h2>
                  <p className="text-lg text-gray-600">
                    Please select Admin or User dashboard to continue.
                  </p>
                </motion.div>
              } />
            </Routes>
          </AnimatePresence>
        </main>

        {/* Wallet Connect Modal */}
        <AnimatePresence>
          {showConnectModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]"
              onClick={() => setShowConnectModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl sm:text-2xl font-semibold text-gray-800">Connect Wallet</h3>
                  <button 
                    onClick={() => setShowConnectModal(false)} 
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label="Close modal"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {availableWallets.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600 mb-4">Select a wallet to connect:</p>
                    {availableWallets.map((walletKey) => (
                      <button
                        key={walletKey}
                        onClick={() => connectWallet(walletKey)}
                        className="w-full flex items-center px-4 py-3 text-left bg-gray-50 hover:bg-gray-100 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
                      >
                        {window.cardano && window.cardano[walletKey] && window.cardano[walletKey].icon && (
                           <img src={window.cardano[walletKey].icon} alt={`${window.cardano![walletKey].name} icon`} className="w-6 h-6 mr-3 rounded-full"/>
                        )}
                        <span className="text-md font-medium text-gray-700">
                          {window.cardano && window.cardano[walletKey] ? window.cardano[walletKey].name : walletKey}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-gray-600 mb-2">No Cardano wallets detected.</p>
                    <p className="text-sm text-gray-500">
                      Please install a CIP-30 compliant wallet extension (e.g., Nami, Eternl, Lace).
                    </p>
                    <button 
                      onClick={detectWallets} 
                      className="mt-4 px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-800 bg-primary-100 hover:bg-primary-200 rounded-lg transition-colors duration-200"
                    >
                      Refresh Wallets
                    </button>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Router>
  );
}

export default App;
