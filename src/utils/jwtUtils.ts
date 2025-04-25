import { JwtPayload } from 'jsonwebtoken';

// Define a more flexible type combining JwtPayload and our custom structure
export interface CustomJwtPayload extends JwtPayload {
  verified_credentials?: Array<{ format: string; address?: string; [key: string]: any }>;
}

// Define a minimal Request-like interface for the function signature
// This avoids importing the full Express Request type if not needed directly
interface RequestLike {
  user?: CustomJwtPayload;
}

/**
 * Extracts the blockchain wallet address from the verified credentials in a JWT payload.
 * @param req - The Express request object (or object with a 'user' property) containing the decoded user payload.
 * @returns The wallet address string or undefined if not found.
 */
export const getWalletAddressFromJWT = (req: RequestLike): string | undefined => {
  // Log the input user object for debugging
  // console.log('[getWalletAddressFromJWT] Input req.user object:', JSON.stringify(req.user, null, 2));

  const userPayload = req.user;
  if (!userPayload) {
    // console.log('[getWalletAddressFromJWT] req.user is undefined or null.');
    return undefined;
  }

  const credentials = userPayload.verified_credentials;
  // console.log('[getWalletAddressFromJWT] Credentials found on req.user:', JSON.stringify(credentials, null, 2));

  if (!Array.isArray(credentials)) {
    // console.log('[getWalletAddressFromJWT] verified_credentials is not an array or is missing.');
    return undefined;
  }

  const blockchainCred = credentials.find((cred: any) => cred && cred.format === 'blockchain');
  // console.log('[getWalletAddressFromJWT] Found blockchain credential:', JSON.stringify(blockchainCred, null, 2));

  if (!blockchainCred) {
    // console.log('[getWalletAddressFromJWT] No credential with format "blockchain" found.');
    return undefined;
  }

  // console.log('[getWalletAddressFromJWT] Returning address:', blockchainCred.address);
  return blockchainCred.address;
};
