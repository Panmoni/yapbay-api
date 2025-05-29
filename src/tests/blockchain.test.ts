import { expect } from 'chai';
import { CeloService } from '../celo';
import { NetworkService } from '../services/networkService';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Blockchain Contract Integration', function() {
  // These tests require a connection to the Celo Alfajores testnet
  // and will be skipped if the environment variables are not set
  
  let defaultNetwork: any;
  let provider: any;
  let contract: any;
  
  before(async function() {
    try {
      defaultNetwork = await NetworkService.getDefaultNetwork();
      provider = await CeloService.getProviderForNetwork(defaultNetwork.id);
      contract = await CeloService.getContractForNetwork(defaultNetwork.id);
    } catch {
      this.skip();
    }
  });
  
  it('should connect to the Celo Alfajores testnet', async function() {
    const network = await provider.getNetwork();
    expect(network.name).to.equal('alfajores');
  });
  
  it('should load the YapBayEscrow contract', function() {
    expect(contract.target).to.equal(defaultNetwork.contractAddress);
  });
  
  it('should correctly format USDC amounts', function() {
    const amount = 100.5;
    const formatted = CeloService.formatUSDC(amount);
    expect(formatted.toString()).to.equal('100500000'); // 100.5 * 10^6
  });

  it('should correctly parse USDC amounts', function() {
    const amount = BigInt('100500000'); // 100.5 USDC in wei
    const parsed = CeloService.parseUSDC(amount);
    expect(parsed).to.equal(100.5);
  });
  
  it('should be able to read contract constants', async function() {
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
    const nextEscrowId = await contract.nextEscrowId();
    expect(nextEscrowId).to.be.a('bigint');
  });
  
  it('should be able to read the arbitrator address', async function() {
    const arbitrator = await contract.fixedArbitrator();
    expect(ethers.isAddress(arbitrator)).to.be.true;
  });
});