// Rung 2: LIVE ENCRYPT. Produce a real encrypted InEuint32 for value 500
// against Arbitrum Sepolia via the CoFHE coprocessor.
import { Encryptable, EncryptStep } from '@cofhe/sdk';
import { connectAll, showEncrypted } from './lib.mjs';

const t0 = Date.now();
const { account, cofhe } = await connectAll();
console.log('connected as', account.address, 'chain arbitrum-sepolia (421614)');

const [encrypted] = await cofhe
  .encryptInputs([Encryptable.uint32(500n)])
  .onStep((step) => console.log(`  step: ${step} (+${Date.now() - t0}ms)`))
  .execute();

showEncrypted('encrypted InEuint32(500):', encrypted);
console.log(`total ${Date.now() - t0}ms`);
