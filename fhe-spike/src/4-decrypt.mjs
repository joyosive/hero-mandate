// Bonus: prove the whole loop by DECRYPTING the remaining encrypted authority
// off-chain via a CoFHE permit. Expected: 500 (granted) - 40 (acted) = 460.
import { FheTypes } from '@cofhe/sdk';
import { keccak256, toBytes } from 'viem';
import { connectAll, ADDRESSES, AUTHORITY_ABI } from './lib.mjs';

const AGENT_LABEL = process.env.AGENT_LABEL ?? 'hero-mandate-spike-1';
const TARGET = process.env.TARGET ?? ADDRESSES.oldConfidentialAuthority;
const agentId = keccak256(toBytes(AGENT_LABEL));

const { account, publicClient, cofhe } = await connectAll();

const ctHash = await publicClient.readContract({
  address: TARGET, abi: AUTHORITY_ABI, functionName: 'remainingAuthority',
  args: [account.address, agentId],
});
console.log('remainingAuthority ciphertext handle: 0x' + ctHash.toString(16));

await cofhe.permits.getOrCreateSelfPermit();
console.log('permit ready, decrypting for view...');

const plaintext = await cofhe.decryptForView(ctHash, FheTypes.Uint32).execute();
console.log('DECRYPTED remaining authority:', plaintext.toString(), '(expected 460)');
