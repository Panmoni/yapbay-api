import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import YapBayEscrowABI from './contract/YapBayEscrow.json';
import { YapBayEscrow } from './types/YapBayEscrow';

dotenv.config();

// Environment variables
const CELO_RPC_URL = process.env.CELO_RPC_URL || 'https://alfajores-forno.celo-testnet.org';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0xC8BFB8a31fFbAF5c85bD97a1728aC43418B5871C';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.warn('Warning: PRIVATE_KEY not set in environment variables');
}

// Define Celo Alfajores network details
const celoAlfajoresNetwork = {
    name: "celo-alfajores",
    chainId: 44787,
    _defaultProvider: (providers: any) => new providers.JsonRpcProvider(CELO_RPC_URL)
};

// Set up provider with explicit network details
const provider = new ethers.JsonRpcProvider(CELO_RPC_URL, celoAlfajoresNetwork);

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

export {
  provider,
  getSigner,
  getContract,
  getSignedContract,
  formatUSDC,
  parseUSDC
};