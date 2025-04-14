import { provider, getContract, formatUSDC, parseUSDC } from '../src/celo';
import * as dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  try {
    console.log('Testing connection to Celo Alfajores testnet...');
    
    // Test provider connection
    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name} (chainId: ${network.chainId})`);
    
    // Get contract
    const contract = getContract();
    console.log(`Contract address: ${contract.target}`);
    
    // Test reading contract constants
    const maxAmount = await contract.MAX_AMOUNT();
    console.log(`MAX_AMOUNT: ${maxAmount} (${parseUSDC(maxAmount)} USDC)`);
    
    const depositDuration = await contract.DEPOSIT_DURATION();
    console.log(`DEPOSIT_DURATION: ${depositDuration} seconds`);
    
    const fiatDuration = await contract.FIAT_DURATION();
    console.log(`FIAT_DURATION: ${fiatDuration} seconds`);
    
    // Test reading next escrow ID
    const nextEscrowId = await contract.nextEscrowId();
    console.log(`Next escrow ID: ${nextEscrowId}`);
    
    // Test reading arbitrator address
    const arbitrator = await contract.fixedArbitrator();
    console.log(`Arbitrator address: ${arbitrator}`);
    
    // Test USDC formatting
    const testAmount = 10.5;
    const formattedAmount = formatUSDC(testAmount);
    console.log(`Formatting ${testAmount} USDC: ${formattedAmount}`);
    console.log(`Parsing back: ${parseUSDC(formattedAmount)} USDC`);
    
    console.log('\nConnection test successful! ✅');
  } catch (error) {
    console.error('Error testing connection:');
    console.error(error);
    process.exit(1);
  }
}

testConnection().catch(console.error);