// Rung 3: LIVE TX. grantAuthority(agentId, encLimit=enc(500)) on the OLD
// ConfidentialAuthority at 0x977b...cdd95 (zero events ever, until now?).
// Simulates first; only sends if the simulation passes.
import { Encryptable } from '@cofhe/sdk';
import { keccak256, toBytes } from 'viem';
import { connectAll, showEncrypted, ADDRESSES, AUTHORITY_ABI } from './lib.mjs';

const AGENT_LABEL = process.env.AGENT_LABEL ?? 'hero-mandate-spike-1';
const TARGET = process.env.TARGET ?? ADDRESSES.oldConfidentialAuthority;
const agentId = keccak256(toBytes(AGENT_LABEL));
console.log('target contract:', TARGET);
console.log('agentId = keccak("' + AGENT_LABEL + '") =', agentId);

const { account, publicClient, walletClient, cofhe } = await connectAll();

// pre-check: agent must be unregistered for this operator
const [op] = await publicClient.readContract({
  address: TARGET, abi: AUTHORITY_ABI, functionName: 'agentInfo',
  args: [account.address, agentId],
});
if (op !== '0x0000000000000000000000000000000000000000') {
  console.log('agent already registered to', op, '- pick a new AGENT_LABEL');
  process.exit(1);
}

const [enc] = await cofhe.encryptInputs([Encryptable.uint32(500n)]).execute();
showEncrypted('encLimit enc(500):', enc);

const args = [agentId, {
  ctHash: enc.ctHash,
  securityZone: enc.securityZone,
  utype: enc.utype,
  signature: enc.signature,
}];

console.log('simulating grantAuthority...');
const { request } = await publicClient.simulateContract({
  address: TARGET, abi: AUTHORITY_ABI, functionName: 'grantAuthority',
  args, account,
});
console.log('simulation OK, sending tx...');

const hash = await walletClient.writeContract(request);
console.log('tx sent:', hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('status:', receipt.status, '| block:', receipt.blockNumber.toString(),
  '| gasUsed:', receipt.gasUsed.toString());
console.log('logs emitted:', receipt.logs.length);
for (const log of receipt.logs) {
  console.log('  log @', log.address, 'topic0:', log.topics[0]);
}
console.log('explorer: https://sepolia.arbiscan.io/tx/' + hash);
