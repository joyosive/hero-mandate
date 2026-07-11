// Rung 5: FULL BEAT. act(agentId, encAmount=enc(40), proofRoot) on the OLD
// ConfidentialAuthority: homomorphic compare vs the encrypted limit, branchless
// budget decrement, and a public proof anchored in HeroProofAnchor.
import { Encryptable } from '@cofhe/sdk';
import { keccak256, toBytes } from 'viem';
import { connectAll, showEncrypted, ADDRESSES, AUTHORITY_ABI, ANCHOR_ABI } from './lib.mjs';

const AGENT_LABEL = process.env.AGENT_LABEL ?? 'hero-mandate-spike-1';
const ACTION_LABEL = process.env.ACTION_LABEL ?? 'spike-action-1';
const TARGET = process.env.TARGET ?? ADDRESSES.oldConfidentialAuthority;
const agentId = keccak256(toBytes(AGENT_LABEL));
const proofRoot = keccak256(toBytes(ACTION_LABEL));
console.log('target contract:', TARGET);
console.log('agentId:', agentId);
console.log('proofRoot = keccak("' + ACTION_LABEL + '") =', proofRoot);

const { account, publicClient, walletClient, cofhe } = await connectAll();

const [enc] = await cofhe.encryptInputs([Encryptable.uint32(40n)]).execute();
showEncrypted('encAmount enc(40):', enc);

const args = [agentId, {
  ctHash: enc.ctHash,
  securityZone: enc.securityZone,
  utype: enc.utype,
  signature: enc.signature,
}, proofRoot];

console.log('simulating act...');
const { request } = await publicClient.simulateContract({
  address: TARGET, abi: AUTHORITY_ABI, functionName: 'act',
  args, account,
});
console.log('simulation OK, sending tx...');

const hash = await walletClient.writeContract(request);
console.log('tx sent:', hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('status:', receipt.status, '| block:', receipt.blockNumber.toString(),
  '| gasUsed:', receipt.gasUsed.toString());
for (const log of receipt.logs) {
  console.log('  log @', log.address, 'topic0:', log.topics[0]);
}
console.log('explorer: https://sepolia.arbiscan.io/tx/' + hash);

// confirm the proof root landed in HeroProofAnchor
const [anchored, ts, submitter] = await publicClient.readContract({
  address: ADDRESSES.heroProofAnchor, abi: ANCHOR_ABI, functionName: 'verify',
  args: [proofRoot],
});
console.log('HeroProofAnchor.verify(proofRoot):',
  { anchored, timestamp: ts.toString(), submitter });
