// Simple script to test the transaction endpoints
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const API_URL = 'http://localhost:3000'; // Adjust if your API runs on a different port
const JWT_TOKEN = process.env.TEST_JWT_TOKEN; // Add a test token to your .env file

if (!JWT_TOKEN) {
  console.error('Please set TEST_JWT_TOKEN in your .env file');
  process.exit(1);
}

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${JWT_TOKEN}`
  }
});

async function testRecordTransaction() {
  try {
    const response = await api.post('/transactions/record', {
      trade_id: 1, // Replace with a valid trade ID from your database
      transaction_hash: '0x' + '1'.repeat(64),
      transaction_type: 'FUND_ESCROW',
      from_address: '0x' + 'a'.repeat(40),
      to_address: '0x' + 'b'.repeat(40),
      amount: '100',
      token_type: 'USDC',
      status: 'SUCCESS',
      metadata: {
        test: 'metadata',
        someValue: 123
      }
    });
    
    console.log('Record Transaction Response:', response.data);
    return response.data.transactionId;
  } catch (error) {
    console.error('Error recording transaction:', error.response?.data || error.message);
    return null;
  }
}

async function testGetTradeTransactions(tradeId) {
  try {
    const response = await api.get(`/transactions/trade/${tradeId}`);
    console.log('Trade Transactions Response:', response.data);
  } catch (error) {
    console.error('Error getting trade transactions:', error.response?.data || error.message);
  }
}

async function testGetUserTransactions() {
  try {
    const response = await api.get('/transactions/user');
    console.log('User Transactions Response:', response.data);
  } catch (error) {
    console.error('Error getting user transactions:', error.response?.data || error.message);
  }
}

async function runTests() {
  console.log('Testing transaction endpoints...');
  
  // Test recording a transaction
  const transactionId = await testRecordTransaction();
  
  if (transactionId) {
    // Test getting trade transactions
    await testGetTradeTransactions(1); // Replace with a valid trade ID
    
    // Test getting user transactions
    await testGetUserTransactions();
  }
  
  console.log('Tests completed.');
}

runTests();
