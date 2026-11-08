/**
 * Generate the game's certificate-authority keypair.
 *   npm run keygen
 * Put GAME_AUTHORITY_SECRET in the server's .env (never commit it) and pass the
 * public key to the contract's `new` call as `game_authority`.
 */
import { CertificateAuthority } from '../apps/server/src/near/certificates';

const { secretHex, publicKey } = CertificateAuthority.generate();
console.log(`GAME_AUTHORITY_SECRET=${secretHex}`);
console.log(`GAME_AUTHORITY_PUBLIC_KEY=${publicKey}`);
console.error('\nKeep the secret private. The public key goes into the contract init call.');
