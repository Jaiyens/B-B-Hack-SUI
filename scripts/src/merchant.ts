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
const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const COST_PER_FLAG = 3_849_000n;
const sender = keypair.getPublicKey().toSuiAddress();

(async () => {
  console.log(`Buying flag as ${sender}`);

  const coins = await suiClient.listCoins({ owner: sender, coinType: USDC_TYPE });
  if (coins.objects.length === 0) {
    console.error('No USDC found. Get testnet USDC from https://faucet.circle.com/');
    return;
  }

  const totalUsdc = coins.objects.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  console.log(`USDC balance: ${totalUsdc} (${Number(totalUsdc) / 1e6} USDC)`);

  if (totalUsdc < COST_PER_FLAG) {
    console.error(`Need ${COST_PER_FLAG} USDC units, only have ${totalUsdc}`);
    return;
  }

  const tx = new Transaction();

  if (coins.objects.length > 1) {
    const [primary, ...rest] = coins.objects;
    tx.mergeCoins(
      tx.object(primary.objectId),
      rest.map(c => tx.object(c.objectId)),
    );
    const [paymentCoin] = tx.splitCoins(tx.object(primary.objectId), [tx.pure.u64(COST_PER_FLAG)]);
    const flag = tx.moveCall({
      target: `${PACKAGE_ID}::merchant::buy_flag`,
      arguments: [paymentCoin],
    });
    tx.transferObjects([flag], tx.pure.address(sender));
  } else {
    const [paymentCoin] = tx.splitCoins(tx.object(coins.objects[0].objectId), [tx.pure.u64(COST_PER_FLAG)]);
    const flag = tx.moveCall({
      target: `${PACKAGE_ID}::merchant::buy_flag`,
      arguments: [paymentCoin],
    });
    tx.transferObjects([flag], tx.pure.address(sender));
  }

  console.log('Buying flag...');
  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true },
  });

  if (result.$kind === 'FailedTransaction') {
    console.error('FAILED:', result.FailedTransaction?.digest);
  } else {
    console.log('Merchant flag captured! Digest:', result.Transaction?.digest);
  }
})();
