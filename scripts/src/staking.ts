import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import keyPairJson from "../keypair.json" with { type: "json" };

const keypair = Ed25519Keypair.fromSecretKey(keyPairJson.privateKey);
const suiClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

const PACKAGE_ID = '0x936313e502e9cbf6e7a04fe2aeb4c60bc0acd69729acc7a19921b33bebf72d03';
const STAKING_POOL = '0x9cd5b5fe69a62761859536720b9b07c48a1e43b95d8c291855d9fc6779a3b494';
const CLOCK = '0x6';
const RECEIPT_TYPE = `${PACKAGE_ID}::staking::StakeReceipt`;

const NUM_STAKES = 168;
const ONE_SUI = 1_000_000_000n;

const sender = keypair.getPublicKey().toSuiAddress();

async function fetchReceipts(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const page = await suiClient.listOwnedObjects({
      owner: sender,
      type: RECEIPT_TYPE,
      cursor,
      limit: 50,
    });
    for (const obj of page.objects) {
      ids.push(obj.objectId);
    }
    hasMore = page.hasNextPage;
    cursor = page.cursor;
  }
  return ids;
}

async function stake() {
  console.log(`Staking as ${sender}`);

  const coinList = await suiClient.listCoins({ owner: sender, coinType: '0x2::sui::SUI' });
  const extraCoins = coinList.objects.slice(1).map(c => c.objectId);

  const perCoin = ONE_SUI / BigInt(NUM_STAKES);
  const amounts: bigint[] = [];
  for (let i = 0; i < NUM_STAKES - 1; i++) {
    amounts.push(perCoin);
  }
  amounts.push(ONE_SUI - perCoin * BigInt(NUM_STAKES - 1));

  const tx = new Transaction();
  tx.setGasBudget(500_000_000);

  if (extraCoins.length > 0) {
    tx.mergeCoins(tx.gas, extraCoins.map(id => tx.object(id)));
  }

  const coins = tx.splitCoins(tx.gas, amounts.map(a => tx.pure.u64(a)));

  const receipts: ReturnType<typeof tx.moveCall>[] = [];
  for (let i = 0; i < NUM_STAKES; i++) {
    const receipt = tx.moveCall({
      target: `${PACKAGE_ID}::staking::stake`,
      arguments: [
        tx.object(STAKING_POOL),
        coins[i],
        tx.object(CLOCK),
      ],
    });
    receipts.push(receipt);
  }

  tx.transferObjects(
    receipts.map(r => r),
    tx.pure.address(sender),
  );

  console.log('Sending stake transaction...');
  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true, objectTypes: true },
  });

  if (result.$kind === 'FailedTransaction') {
    console.error('Transaction FAILED:', result.FailedTransaction?.digest);
    return;
  }

  console.log('Transaction succeeded:', result.Transaction?.digest);
  console.log('Timer started. Wait 1 hour, then run: pnpm staking claim');
}

async function claim() {
  console.log(`Claiming as ${sender}`);

  const receiptIds = await fetchReceipts();
  console.log(`Found ${receiptIds.length} receipts`);

  if (receiptIds.length === 0) {
    console.error('No receipts found. Run "pnpm staking stake" first.');
    return;
  }

  const tx = new Transaction();
  tx.setGasBudget(500_000_000);

  const updated: ReturnType<typeof tx.moveCall>[] = [];
  for (const id of receiptIds) {
    const receipt = tx.moveCall({
      target: `${PACKAGE_ID}::staking::update_receipt`,
      arguments: [
        tx.object(id),
        tx.object(CLOCK),
      ],
    });
    updated.push(receipt);
  }

  let merged = updated[0];
  for (let i = 1; i < updated.length; i++) {
    merged = tx.moveCall({
      target: `${PACKAGE_ID}::staking::merge_receipts`,
      arguments: [
        merged,
        updated[i],
        tx.object(CLOCK),
      ],
    });
  }

  const [flag, coin] = tx.moveCall({
    target: `${PACKAGE_ID}::staking::claim_flag`,
    arguments: [
      tx.object(STAKING_POOL),
      merged,
      tx.object(CLOCK),
    ],
  });

  tx.transferObjects([flag, coin], tx.pure.address(sender));

  console.log('Sending claim transaction...');
  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true, objectTypes: true },
  });

  if (result.$kind === 'FailedTransaction') {
    console.error('Transaction FAILED:', result.FailedTransaction?.digest);
    return;
  }

  console.log('Claim succeeded! Digest:', result.Transaction?.digest);
  console.log('Flag captured!');
}

(async () => {
  const args = process.argv.slice(2).filter(a => a !== '--');
  const command = args[0];

  if (command === 'claim') {
    await claim();
  } else if (command === 'stake' || !command) {
    const receipts = await fetchReceipts();
    if (receipts.length > 0) {
      console.log(`Found ${receipts.length} existing receipts. Running claim...`);
      await claim();
    } else {
      await stake();
    }
  } else {
    console.log('Usage: pnpm staking [stake|claim]');
    console.log('  stake - Split 1 SUI into 168 coins and stake them');
    console.log('  claim - Update, merge, and claim flag (after 1 hour)');
    console.log('  (no arg) - Auto-detect: stake if no receipts, claim if receipts exist');
  }
})();
