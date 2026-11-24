import { beforeAll, describe, expect, it } from 'vitest';

import { loadBundle, loadSigningData } from './helpers/bundle';
import { runSignerCase, signerCases } from './signer-checks';
import type { SigningData } from './signer-support';
import type { Api } from './vector-checks';

// The same cases run in Chromium by `scripts/run-browser-vectors.mjs`.
describe('signer, path policy, errors and preview (built bundle in Node)', () => {
  let api: Api;
  let data: SigningData;

  beforeAll(async () => {
    api = await loadBundle();
    data = loadSigningData();
  });

  signerCases().forEach(({ group, name }, index) => {
    it(`${group}: ${name}`, async () => {
      const result = await runSignerCase(api, data, index);
      expect(result.failures.slice(0, 20)).toEqual([]);
      expect(result.checks).toBeGreaterThan(0);
    });
  });
});
