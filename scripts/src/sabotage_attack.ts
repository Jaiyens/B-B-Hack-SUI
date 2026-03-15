/**
 * SABOTAGE ARENA ATTACK MODE
 *
 * Run this with an ALT keypair to attack other players and reduce their shields.
 * This helps your MAIN account (running sabotage-arena.ts) by weakening competition.
 *
 * Setup:
 * 1. Create alt keypair: cp keypair.json alt-keypair.json, then edit alt-keypair.json
 *    with a new keypair from pnpm init-keypair (run in another folder, copy the output)
 * 2. Fund the alt address from faucet
 * 3. Run: pnpm sabotage-attack
 *
 * The alt will register, then attack the highest-shield player every 10 min.
 * Keep your main running sabotage-arena in another terminal.
 */
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as fs from 'fs';

const PACKAGE_ID = '0xaff30ff9a4b40845d8bdc91522a2b8e8e542ee41c0855f5cb21a652a00c45e96';
const ARENA = '0xd7dd51e3c156a0c0152cad6bc94884db5302979e78f04d631a51ab107f9449e6';
const PLAYERS_TABLE = '0xf3f63bf6a1d4bbf5ba9935eb8eead79d41db29f8c717b8395b74cea8fdb0418c';
const CLOCK = '0x6';
const MAIN_ADDRESS = '0x96d6a0c680e075fc23f3b79d7270d5bcb7c1c405d88013d7f359edf6cffaaae0';
const COOLDOWN_MS = 600_000;

const altKeypair = (() => {
  try {
    const alt = JSON.parse(fs.readFileSync('./alt-keypair.json', 'utf-8'));
    return Ed25519Keypair.fromSecretKey(alt.privateKey);
  } catch {
    console.error('Create alt-keypair.json (copy from keypair.json, use different keypair)');
    process.exit(1);
  }
})();

const suiClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

const sender = altKeypair.getPublicKey().toSuiAddress();

const OTHER_PLAYERS = [
  '0x178eedc1411c185c37e9b49ea9d52bc7df451caf906aef3ea838b2ac9287d5c4',
  '0xc29068d9bb3babcbe772f6ea9cf7807d06f6d04cb6adfcdc6c9493e4cace184a',
  '0xac5f3f214791cae8df8d037b1f88eac3d2376ca58085625741e6d1e4c6d79a56',
  '0x1f9a65ad76493007d9bd7fb1127bbbb032579ba48143ccd7e892cd68d03d790c',
  '0x3eb2c8e669dc1478369db4a50c6db1fe45ae6d34f5d61200dd58f5e51d41217e',
  '0x8173caf87aa07eab0b935aa06835de584a72eb6d4364d71c2dbd3602bd33ee77',
  '0xb2045fa3bf18769410dc391af4550d286db8f6c1c282ea3a4dfbae5b0e51613f',
  '0x9f7fce4e48eca8d8961024e65ed890a6ef434ca6bf87ee4059446887c606bc29',
  '0xa7277a0bd2f3ba69b971779158eaa94c4b36e64c063fb684e86e315ae32ba9ef',
  '0x644047163ef7b5e2e34a0c07e480e02efa1e8606633bbb9302716d5793eb5a4d',
  '0x6bb342968f788b93c661080093b3e18c969ebfa4c4bcd6d5e3faa7f847c39051',
  '0xc9c599caebc463aa9e361f04b1ece1a8fdecc78874b1c38eda977e3d3fa8c58f',
  '0x77e19fca3e40e17c66d468edcd7782126eb37b68fce18b7a6ed0a7415a8e9f92',
  '0xb167a1a6c5a27991c8d84208f93a46fe29c3336d127104270aabc5f966c2887c',
  '0x9b98f6e6c716dd728e7b7956d36cf0f42b26783adaa2f5c9addca5a472105519',
  '0xe97d25daf886dfcec40df3c649b234e2d550456e45997d55082f464a421573ed',
  '0xebbe4848e7e454ba9324d91ae49e04f51fbedcf209cc1ce3b4ddbd610ecf7995',
  '0x5c0899cc1044c748803b5920cffacb69b9cf46c621caf7e8f80f8ef189097b8d',
  '0x89f4100f0ffa1978ea6d212119cc58e5bad50bb3de4d2835de8a0d0d9aa3638a',
  '0x13b00bda1c9810711c656e496f19ab3f6ef36c8ada6cdabed6296298f7bfc088',
];

async function getAttackTarget(): Promise<string> {
  const fields = await suiClient.getDynamicFields({ parentId: PLAYERS_TABLE, limit: 30 });
  const items = (fields as any).data ?? (fields as any).objects ?? [];
  for (const item of items) {
    const name = (item.name as { value?: string })?.value ?? '';
    if (!name || name.toLowerCase() === MAIN_ADDRESS.toLowerCase()) continue;
    try {
      const obj = await suiClient.getObject({ id: item.objectId });
      const content = (obj as any).data?.content?.fields ?? (obj as any).result?.content?.fields;
      const val = content?.value?.fields ?? content?.value;
      const shield = Number(val?.shield ?? 0);
      if (shield > 0) return name;
    } catch {
      /* skip */
    }
  }
  return OTHER_PLAYERS[Math.floor(Math.random() * OTHER_PLAYERS.length)];
}

async function register() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::register`,
    arguments: [tx.object(ARENA), tx.object(CLOCK)],
  });
  const r = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: altKeypair });
  if (r.$kind === 'FailedTransaction') return false;
  return true;
}

async function attack(target: string): Promise<boolean> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::attack`,
    arguments: [tx.object(ARENA), tx.pure.address(target), tx.object(CLOCK)],
  });
  try {
    const r = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: altKeypair });
    return r.$kind !== 'FailedTransaction';
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  console.log(`Attack bot as ${sender}`);
  await register();

  while (true) {
    const target = await getAttackTarget();
    console.log(`Attacking ${target.slice(0, 16)}...`);
    const ok = await attack(target);
    console.log(ok ? 'Hit!' : 'Miss (target had 0 shield)');
    console.log(`Waiting ${COOLDOWN_MS / 1000}s...`);
    await sleep(COOLDOWN_MS + 2000);
  }
})();
