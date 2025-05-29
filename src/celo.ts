import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import YapBayEscrowABI from './contract/YapBayEscrow.json';
import { YapBayEscrow } from './types/YapBayEscrow';

dotenv.config();

// Determine if we're using testnet or mainnet
const USE_TESTNET = process.env.NODE_ENV === 'development' || process.env.USE_TESTNET === 'true';

// Environment variables with testnet/mainnet support
const CELO_RPC_URL = USE_TESTNET 
  ? (process.env.CELO_RPC_URL_TESTNET || 'https://alfajores-forno.celo-testnet.org')
  : (process.env.CELO_RPC_URL || 'https://forno.celo.org');

const CONTRACT_ADDRESS = USE_TESTNET
  ? (process.env.CONTRACT_ADDRESS_TESTNET || '0xC8BFB8a31fFbAF5c85bD97a1728aC43418B5871C')
  : (process.env.CONTRACT_ADDRESS || '0x8E2749B2d3B84c7985e6F3FB2AB7A96399596095');

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.warn('Warning: PRIVATE_KEY not set in environment variables');
}

// Define network details based on testnet/mainnet
const celoNetwork = USE_TESTNET 
  ? {
      name: 'celo-alfajores',
      chainId: 44787,
    }
  : {
      name: 'celo-mainnet',
      chainId: 42220,
    };

console.log(`Using ${USE_TESTNET ? 'Testnet' : 'Mainnet'}: ${CELO_RPC_URL}`);
console.log(`Contract Address: ${CONTRACT_ADDRESS}`);

// Set up provider with explicit network details
const provider = new ethers.JsonRpcProvider(CELO_RPC_URL, celoNetwork);

const CELO_WS_URL = USE_TESTNET
  ? (process.env.CELO_WS_URL_TESTNET || CELO_RPC_URL.replace(/^https?/, 'wss') + '/ws')
  : (process.env.CELO_WS_URL || CELO_RPC_URL.replace(/^https?/, 'wss') + '/ws');

export const wsProvider = new ethers.WebSocketProvider(CELO_WS_URL, celoNetwork);

// Set up signer if private key is available
const getSigner = () => {
  if (!PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY not set in environment variables');
  }
  return new ethers.Wallet(PRIVATE_KEY, provider);
};

// Initialize contract
const getContract = (signerOrProvider: ethers.ContractRunner = provider): YapBayEscrow => {
  return new ethers.Contract(
    CONTRACT_ADDRESS,
    YapBayEscrowABI.abi,
    signerOrProvider
  ) as unknown as YapBayEscrow;
};

// Get contract with signer
const getSignedContract = (): YapBayEscrow => {
  const signer = getSigner();
  return getContract(signer);
};

// Utility function to format USDC amounts (6 decimals)
const formatUSDC = (amount: number): bigint => {
  return ethers.parseUnits(amount.toString(), 6);
};

// Utility function to parse USDC amounts
const parseUSDC = (amount: bigint): number => {
  return Number(ethers.formatUnits(amount, 6));
};

// Convenience functions for new contract methods
const getEscrowBalance = async (escrowId: number): Promise<{stored: string, calculated: string}> => {
  const contract = getContract();
  const [stored, calculated] = await Promise.all([
    contract.getStoredEscrowBalance(escrowId),
    contract.getCalculatedEscrowBalance(escrowId)
  ]);
  
  return {
    stored: ethers.formatUnits(stored, 6),
    calculated: ethers.formatUnits(calculated, 6)
  };
};

const getSequentialInfo = async (escrowId: number) => {
  const contract = getContract();
  const info = await contract.getSequentialEscrowInfo(escrowId);
  
  return {
    isSequential: info.isSequential,
    sequentialAddress: info.sequentialAddress,
    sequentialBalance: ethers.formatUnits(info.sequentialBalance, 6),
    wasReleased: info.wasReleased
  };
};

const checkAutoCancelEligible = async (escrowId: number): Promise<boolean> => {
  const contract = getContract();
  return await contract.isEligibleForAutoCancel(escrowId);
};

export { 
  provider, 
  getSigner, 
  getContract, 
  getSignedContract, 
  formatUSDC, 
  parseUSDC,
  getEscrowBalance,
  getSequentialInfo,
  checkAutoCancelEligible
};
