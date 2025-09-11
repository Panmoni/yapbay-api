import { NetworkService } from '../src/services/networkService';
import { BlockchainServiceFactory } from '../src/services/blockchainService';
import { formatUSDC, parseUSDC } from '../src/celo';
import * as dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  try {
    console.log('Testing connection to Solana Devnet...');

    // Get default network (should be Solana Devnet)
    const defaultNetwork = await NetworkService.getDefaultNetwork();
    console.log(
      `Default network: ${defaultNetwork.name} (family: ${defaultNetwork.networkFamily})`
    );

    // Create blockchain service
    const blockchainService = BlockchainServiceFactory.create(defaultNetwork);
    console.log(`Network family: ${blockchainService.getNetworkFamily()}`);

    // Test network info
    const networkInfo = await blockchainService.getNetworkInfo();
    console.log(`Network info:`, networkInfo);

    // Test address validation
    const testSolanaAddress = '11111111111111111111111111111112'; // System program
    const isValidAddress = blockchainService.validateAddress(testSolanaAddress);
    console.log(`Solana address validation: ${testSolanaAddress} -> ${isValidAddress}`);

    // Test transaction hash validation
    const testSignature =
      '1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111';
    const isValidSignature = blockchainService.validateTransactionHash(testSignature);
    console.log(`Solana signature validation: ${isValidSignature}`);

    // Test block explorer URL
    const explorerUrl = blockchainService.getBlockExplorerUrl(testSignature);
    console.log(`Block explorer URL: ${explorerUrl}`);

    // Test USDC formatting (still works for Solana)
    const testAmount = 10.5;
    const formattedAmount = formatUSDC(testAmount);
    console.log(`Formatting ${testAmount} USDC: ${formattedAmount}`);
    console.log(`Parsing back: ${parseUSDC(formattedAmount)} USDC`);

    console.log('\nSolana connection test successful! ✅');
  } catch (error) {
    console.error('Error testing connection:');
    console.error(error);
    process.exit(1);
  }
}

testConnection().catch(console.error);
