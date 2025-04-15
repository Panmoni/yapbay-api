// scripts/decode-jwt.ts
import jwt from 'jsonwebtoken';

// Get the token from command line arguments
const token = process.argv[2];

if (!token) {
  console.error('Usage: ts-node scripts/decode-jwt.ts <your_jwt_token>');
  process.exit(1);
}

try {
  // Decode the token (without verification, just to see the payload)
  const decoded = jwt.decode(token, { complete: true }); // Use complete: true to see header too

  if (!decoded) {
    console.error('Invalid token provided.');
    process.exit(1);
  }

  console.log('Decoded JWT Header:');
  console.log(JSON.stringify(decoded.header, null, 2));
  console.log('\nDecoded JWT Payload:');
  console.log(JSON.stringify(decoded.payload, null, 2));

} catch (error) {
  console.error('Error decoding token:', error);
  process.exit(1);
}