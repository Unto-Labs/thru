import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { SigningData } from '../signer-support';
import type { Api, Vectors } from '../vector-checks';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/** The vector file the Rust host wrote. */
export function loadVectors(): Vectors {
  const path = here('../../../../../../contrib/test/vectors/trezor/host_vectors.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Vectors;
}

/**
 * The file `name` of the build: `dist/` of the package, or of the directory
 * named by `THRU_TREZOR_DIST` (a build made with `tsup --out-dir`, so that a
 * run does not need to replace `dist/`).
 */
export function distFile(name: string): string {
  const dist = process.env.THRU_TREZOR_DIST;
  return dist === undefined || dist === '' ? here(`../../../dist/${name}`) : join(dist, name);
}

/** The built browser bundle (`pnpm build` first), loaded in Node. */
export async function loadBundle(): Promise<Api> {
  return (await import(/* @vite-ignore */ pathToFileURL(distFile('index.js')).href)) as Api;
}

/**
 * The app's files and the shared signing vectors, read from where they live
 * (`trezor/app-thru/`, `contrib/test/vectors/signing/`): the preview is tied
 * to the app's fixture and texts, which are never copied.
 */
export function loadSigningData(): SigningData {
  const read = (relative: string): unknown => JSON.parse(readFileSync(here(`../../../../../../${relative}`), 'utf8'));
  return {
    fixture: read('trezor/app-thru/tests/fixtures/sign_tx.json') as SigningData['fixture'],
    en: read('trezor/app-thru/translations/en.json') as SigningData['en'],
    hd: read('contrib/test/vectors/signing/hd_vectors.json') as SigningData['hd'],
    messages: read('contrib/test/vectors/signing/message_vectors.json') as SigningData['messages'],
    eoa: read('contrib/test/vectors/signing/eoa_auth_vectors.json') as SigningData['eoa'],
  };
}
