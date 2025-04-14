import { expect } from 'chai';
import { provider, getContract, formatUSDC, parseUSDC } from '../celo';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Blockchain Contract Integration', function() {
  // These tests require a connection to the Celo Alfajores testnet
  // and will be skipped if the environment variables are not set
  
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  
  before(function() {
    if (!CONTRACT_ADDRESS) {
      this.skip();
    }
  });
  
  it('should connect to the Celo Alfajores testnet', async function() {
    const network = await provider.getNetwork();
    expect(network.name).to.equal('alfajores');
  });
  
  it('should load the YapBayEscrow contract', function() {
    const contract = getContract();
    expect(contract.target).to.equal(CONTRACT_ADDRESS);
  });
  
  it('should correctly format USDC amounts', function() {
    const amount = 10.5;
    const formatted = formatUSDC(amount);
    expect(formatted).to.equal(10500000n); // 10.5 with 6 decimal places
  });
  
  it('should correctly parse USDC amounts', function() {
    const amount = 10500000n; // 10.5 with 6 decimal places
    const parsed = parseUSDC(amount);
    expect(parsed).to.equal(10.5);
  });
  
  it('should be able to read contract constants', async function() {
    const contract = getContract();
    
    // Test reading a constant from the contract
    const maxAmount = await contract.MAX_AMOUNT();
    expect(maxAmount).to.be.a('bigint');
    expect(Number(maxAmount)).to.be.greaterThan(0);
    
    // Test reading another constant
    const depositDuration = await contract.DEPOSIT_DURATION();
    expect(depositDuration).to.be.a('bigint');
    expect(Number(depositDuration)).to.be.greaterThan(0);
  });
  
  it('should be able to read the next escrow ID', async function() {
    const contract = getContract();
    const nextEscrowId = await contract.nextEscrowId();
    expect(nextEscrowId).to.be.a('bigint');
  });
  
  it('should be able to read the arbitrator address', async function() {
    const contract = getContract();
    const arbitrator = await contract.fixedArbitrator();
    expect(ethers.isAddress(arbitrator)).to.be.true;
  });
});