// A check of a real Trezor Safe 7 from Node, through the optional native package
// `usb` (the `@thru/trezor/node-usb` entry): it connects, pairs by the code the
// device shows (typed here, once; the credential is kept in a file and used the
// next time), loads the Thru app from the three files of its image, prints the
// address of an account (and shows it on the device), signs one text message
// (the device shows it and asks to hold to confirm), and prints the signature,
// which the signer has already verified against the device's key.
//
//   node scripts/device-check.mjs --tapp <app.tapp> --proof <app.proof> \
//     --root-packet <root-packet file> [--path "m/44'/8478'/0'/0'"] \
//     [--message "text"] [--credentials <file>] [--no-display]
//
// --root-packet may be left out when the files are laid out as the app build
// writes them (`.../serialized/<app>/<version>/<name>.tapp` next to
// `.../serialized/root-packets/<file>`). The credential file defaults to
// ~/.config/thru/trezor-web-host-pairing.json (mode 0600; it holds a host
// private key; `rm` it to pair again).
//
// Needs `pnpm --filter @thru/trezor build` first and `usb` installed (it is a
// development dependency of this package: `pnpm install`). Nothing is sent to
// any network. Exits 0 on success and 1 on any failure, printing the typed error.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = await import(join(root, 'dist/index.js'));
const nodeUsb = await import(join(root, 'dist/node-usb.js'));

const args = new Map();
const flags = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--no-display') flags.add(arg);
  else if (arg.startsWith('--')) args.set(arg, process.argv[++i]);
  else throw new Error(`unexpected argument ${arg}`);
}
const need = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`missing ${name} (see the top of this file)`);
  return value;
};

const tappPath = need('--tapp');
const proofPath = need('--proof');
const read = (file) => new Uint8Array(readFileSync(file));
const tapp = read(tappPath);
const rootPacketPath =
  args.get('--root-packet') ?? join(dirname(tappPath), '../../root-packets', api.rootPacketFileName(api.readAppHeader(tapp).appRing));
const image = api.parseAppImage({ tapp, proof: read(proofPath), rootPacket: read(rootPacketPath) });
const path = args.get('--path') ?? "m/44'/8478'/0'/0'";
const message = args.get('--message') ?? `thru device check ${new Date().toISOString()}`;
const credentialsPath = args.get('--credentials') ?? join(homedir(), '.config', 'thru', 'trezor-web-host-pairing.json');

console.log(`image:       ${image.id} ${image.version.join('.')} (${image.chunks.length} chunks)`);
console.log(`credentials: ${credentialsPath}`);

let signer;
let exitCode = 0;
try {
  console.log('looking for the Trezor on USB (close Trezor Suite and the Trezor Bridge first)...');
  const transport = await nodeUsb.openNodeUsbTransport();
  console.log('claimed USB interface 0 of the Trezor');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    signer = await api.connectTrezor({
      transport,
      credentialStore: new nodeUsb.FileCredentialStore(credentialsPath),
      image,
      hostName: 'thru device check',
      appName: 'thru',
      transactionSigningScheme: 'rfc8032',
      ui: {
        pairingCode: async () => (await terminal.question('The device shows six digits. Type them and press Enter: ')).trim(),
        confirmOnDevice: () => console.log('Confirm on the device.'),
        enterPassphraseOnDevice: () => console.log('Enter the passphrase on the device.'),
      },
    });
  } finally {
    terminal.close();
  }
  console.log('connected: the Thru app runs on the device');

  console.log('address: look at the device and compare it with the line below, then confirm.');
  const out = await signer.getAddress(path, { display: !flags.has('--no-display') });
  console.log(`address:     ${out.address}`);
  console.log(`public key:  ${api.toHex(out.publicKey)}`);
  console.log(`path:        ${out.path.path}`);

  console.log(`signing the message ${JSON.stringify(message)}: read it on the device, then hold to confirm.`);
  const signed = await signer.signMessage(path, new TextEncoder().encode(message));
  console.log(`signature:   ${api.toHex(signed.signature)}`);
  console.log(`signed by:   ${api.toHex(signed.publicKey)}`);
  console.log('The signature was verified against the device key before it was returned.');
  console.log('PASSED');
} catch (error) {
  exitCode = 1;
  const kind = error?.kind ? `, kind ${error.kind}` : '';
  const reason = error?.reason ? `, reason ${error.reason}` : '';
  console.error(`FAILED: ${error?.name ?? 'Error'} (code ${error?.code ?? 'none'}${kind}${reason})`);
  console.error(error?.message ?? String(error));
  if (error?.outcomeUnknown) console.error('The request had been sent: the device may have signed even though no answer arrived.');
} finally {
  await signer?.close().catch(() => undefined);
}
// The native USB package can keep the event loop alive after the device is closed.
process.exit(exitCode);
