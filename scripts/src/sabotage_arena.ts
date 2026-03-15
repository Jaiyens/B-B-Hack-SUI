import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import keyPairJson from "../keypair.json" with { type: "json" };

const keypair = Ed25519Keypair.fromSecretKey(keyPairJson.privateKey);
const suiClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

const PACKAGE_ID = '0xaff30ff9a4b40845d8bdc91522a2b8e8e542ee41c0855f5cb21a652a00c45e96';
const ARENA = '0xd7dd51e3c156a0c0152cad6bc94884db5302979e78f04d631a51ab107f9449e6';
const CLOCK = '0x6';
const sender = keypair.getPublicKey().toSuiAddress();

const COOLDOWN_MS = 600_000;
const SHIELD_THRESHOLD = 12;

async function getPlayerState(): Promise<{ shield: number; lastActionMs: number } | null> {
  try {
    const result = await suiClient.getDynamicField({
      parentId: '0xf3f63bf6a1d4bbf5ba9935eb8eead79d41db29f8c717b8395b74cea8fdb0418c',
      name: { type: 'address', value: sender },
    });
    const fields = (result as any).value?.fields || (result as any).value;
    if (fields) {
      return {
        shield: Number(fields.shield),
        lastActionMs: Number(fields.last_action_ms),
      };
    }
  } catch {
    // not registered
  }
  return null;
}

async function register(): Promise<void> {
  console.log('Registering in arena...');
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::register`,
    arguments: [tx.object(ARENA), tx.object(CLOCK)],
  });
  try {
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    });
    if (result.$kind === 'FailedTransaction') {
      console.log('Already registered, continuing...');
    } else {
      console.log(`Registered! Digest: ${result.Transaction?.digest}`);
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes('abort code: 0') || msg.includes('EAlreadyRegistered') || msg.includes('register')) {
      console.log('Already registered, continuing...');
    } else {
      throw e;
    }
  }
}

async function build(): Promise<boolean> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::build`,
    arguments: [tx.object(ARENA), tx.object(CLOCK)],
  });
  try {
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    });
    if (result.$kind === 'FailedTransaction') {
      console.log(`Build failed: ${result.FailedTransaction?.digest}`);
      return false;
    }
    console.log(`Build succeeded: ${result.Transaction?.digest}`);
    return true;
  } catch (e: any) {
    console.log(`Build error: ${e.message?.substring(0, 120)}`);
    return false;
  }
}

async function claimFlag() {
  const tx = new Transaction();
  const flag = tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::claim_flag`,
    arguments: [tx.object(ARENA), tx.object(CLOCK)],
  });
  tx.transferObjects([flag], tx.pure.address(sender));

  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true },
  });
  if (result.$kind === 'FailedTransaction') {
    console.error('Claim failed:', result.FailedTransaction?.digest);
  } else {
    console.log(`\nSABOTAGE ARENA FLAG CAPTURED! Digest: ${result.Transaction?.digest}`);
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  console.log(`Sabotage Arena as ${sender}`);
  console.log(`Shield threshold: ${SHIELD_THRESHOLD}, Cooldown: ${COOLDOWN_MS / 1000}s`);

  await register();

  for (let i = 0; i < 20; i++) {
    const now = Date.now();
    console.log(`\n--- Build attempt ${i + 1} at ${new Date().toISOString()} ---`);

    const success = await build();
    if (!success) {
      console.log('Waiting 30s before retry...');
      await sleep(30_000);
      i--;
      continue;
    }

    // Check if we've reached threshold by counting successful builds
    // We can't easily read on-chain state, so track locally
    const buildCount = i + 1;
    console.log(`Shield: ~${buildCount}/${SHIELD_THRESHOLD}`);

    if (buildCount >= SHIELD_THRESHOLD) {
      console.log('\nShield threshold reached! Claiming flag...');
      await claimFlag();
      return;
    }

    const waitMs = COOLDOWN_MS + 5_000;
    const nextTime = new Date(now + waitMs);
    console.log(`Waiting ${waitMs / 1000}s until ${nextTime.toISOString()}...`);
    await sleep(waitMs);
  }
})();
