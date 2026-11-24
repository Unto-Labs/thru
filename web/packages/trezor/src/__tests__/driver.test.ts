import { beforeAll, describe, expect, it } from 'vitest';

import { loadBundle, loadVectors } from './helpers/bundle';
import { driverCases, runDriverCase } from './driver-checks';
import type { Api, Vectors } from './vector-checks';

// The same cases run in Chromium by `scripts/run-browser-vectors.mjs`.
describe('driver on a scripted transport (built bundle in Node)', () => {
  let api: Api;
  let vectors: Vectors;

  beforeAll(async () => {
    api = await loadBundle();
    vectors = loadVectors();
  });

  driverCases().forEach(({ group, name }, index) => {
    it(`${group}: ${name}`, async () => {
      const result = await runDriverCase(api, vectors, index);
      expect(result.failures).toEqual([]);
      expect(result.checks).toBeGreaterThan(0);
    });
  });
});
