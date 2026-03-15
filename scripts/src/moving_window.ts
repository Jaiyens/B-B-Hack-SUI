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
const CLOCK = '0x6';
const sender = keypair.getPublicKey().toSuiAddress();

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const timeInHour = now % 3600;
  const inWindow = (timeInHour >= 0 && timeInHour < 300) || (timeInHour >= 1800 && timeInHour < 2100);
  console.log(`Time in hour: ${timeInHour}s — window is ${inWindow ? 'OPEN' : 'CLOSED'}`);

  if (!inWindow) {
    const nextWindow = timeInHour < 1800 ? 1800 - timeInHour : 3600 - timeInHour;
    console.log(`Next window opens in ${nextWindow}s (${(nextWindow / 60).toFixed(1)} min). Waiting...`);
    await new Promise(r => setTimeout(r, nextWindow * 1000 + 2000));
  }

  const tx = new Transaction();
  const flag = tx.moveCall({
    target: `${PACKAGE_ID}::moving_window::extract_flag`,
    arguments: [tx.object(CLOCK)],
  });
  tx.transferObjects([flag], tx.pure.address(sender));

  console.log('Extracting moving window flag...');
  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true },
  });

  if (result.$kind === 'FailedTransaction') {
    console.error('FAILED:', result.FailedTransaction?.digest);
  } else {
    console.log('Moving Window flag captured! Digest:', result.Transaction?.digest);
  }
})();
