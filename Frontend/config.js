// Frontend Configuration for Different Environments
const CONFIG = {
    development: {
        backendUrl: "http://localhost:8080/api",
        network: "BSC Testnet",
        debug: true
    },
    production: {
        backendUrl: "https://shib-airdrop-production.up.railway.app/api",
        network: "BSC Mainnet", 
        debug: false
    }
};

// Auto-detect environment
const currentEnv = window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1' ? 
                   'development' : 'production';

export const BACKEND_URL = CONFIG[currentEnv].backendUrl;
export const IS_DEVELOPMENT = currentEnv === 'development';
export const NETWORK = CONFIG[currentEnv].network;
