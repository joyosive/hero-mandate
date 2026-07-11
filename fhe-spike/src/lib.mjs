// Shared setup for the FHE spike: env loading, viem clients, CoFHE client.
// SECURITY: never log the private key or any env values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/node';
import { arbSepolia } from '@cofhe/sdk/chains';

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const envPath = join(HERE, '..', '..', '.env');
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  if (!out.DEPLOYER_PRIVATE_KEY || !out.RPC_ARB_SEPOLIA) {
    throw new Error('missing DEPLOYER_PRIVATE_KEY or RPC_ARB_SEPOLIA in ../.env');
  }
  return out;
}

export const ADDRESSES = {
  oldConfidentialAuthority: '0x977b112bc9d121c8f2567c8a52fd7b6a4f2cdd95',
  heroProofAnchor: '0xb3fa3222130fac54b90e37835dce4f052349571b',
  taskManager: '0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9',
};

export async function connectAll() {
  const env = loadEnv();
  const pk = env.DEPLOYER_PRIVATE_KEY.startsWith('0x')
    ? env.DEPLOYER_PRIVATE_KEY
    : `0x${env.DEPLOYER_PRIVATE_KEY}`;
  const account = privateKeyToAccount(pk);
  const transport = http(env.RPC_ARB_SEPOLIA);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
  const walletClient = createWalletClient({ chain: arbitrumSepolia, transport, account });

  const config = createCofheConfig({ supportedChains: [arbSepolia] });
  const cofhe = createCofheClient(config);
  await cofhe.connect(publicClient, walletClient);
  return { account, publicClient, walletClient, cofhe };
}

// ABI fragments for ConfidentialAuthority (built against cofhe-contracts 0.1.4)
export const IN_EUINT32 = {
  type: 'tuple',
  components: [
    { name: 'ctHash', type: 'uint256' },
    { name: 'securityZone', type: 'uint8' },
    { name: 'utype', type: 'uint8' },
    { name: 'signature', type: 'bytes' },
  ],
};

export const AUTHORITY_ABI = [
  {
    type: 'function', name: 'grantAuthority', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'bytes32' }, { ...IN_EUINT32, name: 'encLimit' }],
    outputs: [],
  },
  {
    type: 'function', name: 'act', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'bytes32' },
      { ...IN_EUINT32, name: 'encAmount' },
      { name: 'proofRoot', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'agentInfo', stateMutability: 'view',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'agentId', type: 'bytes32' }],
    outputs: [{ name: 'op', type: 'address' }, { name: 'actionCount', type: 'uint64' }],
  },
  {
    type: 'function', name: 'remainingAuthority', stateMutability: 'view',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'agentId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'verifyAction', stateMutability: 'view',
    inputs: [{ name: 'proofRoot', type: 'bytes32' }],
    outputs: [
      { name: 'anchored', type: 'bool' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'submitter', type: 'address' },
    ],
  },
  { type: 'event', name: 'AuthorityGranted', inputs: [
    { name: 'agentId', type: 'bytes32', indexed: true },
    { name: 'operator', type: 'address', indexed: true },
  ]},
  { type: 'event', name: 'ActionAnchored', inputs: [
    { name: 'agentId', type: 'bytes32', indexed: true },
    { name: 'proofRoot', type: 'bytes32', indexed: true },
    { name: 'sequence', type: 'uint64', indexed: false },
    { name: 'timestamp', type: 'uint64', indexed: false },
  ]},
];

export const ANCHOR_ABI = [
  { type: 'event', name: 'ProofAnchored', inputs: [
    { name: 'proofRoot', type: 'bytes32', indexed: true },
    { name: 'submitter', type: 'address', indexed: true },
    { name: 'timestamp', type: 'uint64', indexed: false },
  ]},
  {
    type: 'function', name: 'verify', stateMutability: 'view',
    inputs: [{ name: 'proofRoot', type: 'bytes32' }],
    outputs: [
      { name: 'anchored', type: 'bool' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'submitter', type: 'address' },
    ],
  },
];

export function showEncrypted(label, enc) {
  console.log(label, {
    ctHash: '0x' + enc.ctHash.toString(16),
    securityZone: enc.securityZone,
    utype: enc.utype,
    signatureBytes: (enc.signature.length - 2) / 2,
  });
}
