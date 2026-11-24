import { beforeAll, describe, expect, it } from 'vitest';

import { loadBundle, loadVectors } from './helpers/bundle';
import { runAllChecks, type Api, type GroupReport, type Vectors } from './vector-checks';

const GROUPS = ['messages', 'cpace', 'credentials', 'aead', 'packets', 'handshake', 'state replay'];

// The same checks run in Chromium by `scripts/run-browser-vectors.mjs`.
describe('host vectors (built bundle in Node)', () => {
  let api: Api;
  let vectors: Vectors;
  let reports: GroupReport[] = [];

  beforeAll(async () => {
    api = await loadBundle();
    vectors = loadVectors();
    reports = runAllChecks(api, vectors);
  });

  for (const group of GROUPS) {
    it(`${group} agrees with the Rust host`, () => {
      const report = reports.find((r) => r.group === group)!;
      expect(report.cases).toBeGreaterThan(0);
      expect(report.failures.slice(0, 20)).toEqual([]);
    });
  }

  it('pins the known differences between the library and the vectors', () => {
    const ids = reports.flatMap((r) => r.deviations.map((d) => d.id));
    expect([...new Set(ids)].sort()).toEqual(['F1', 'F2', 'F3', 'F4']);
  });
});

// A check that cannot fail proves nothing: each of these changes one value of
// the file and the group that reads it must notice.
describe('the checks notice a changed vector', () => {
  const flip = (hex: string): string => (hex.endsWith('0') ? `${hex.slice(0, -1)}1` : `${hex.slice(0, -1)}0`);
  const mutations: [string, (v: Vectors) => void][] = [
    ['messages', (v) => void (v.messages.cases[3].hex = flip(v.messages.cases[3].hex as string))],
    ['cpace', (v) => void (v.cpace.crypto.exchanges[0].exchange.host_public_key = flip(v.cpace.crypto.exchanges[0].exchange.host_public_key as string))],
    ['cpace', (v) => void (v.cpace.crypto.elligator2[5].output = flip(v.cpace.crypto.elligator2[5].output))],
    ['credentials', (v) => void (v.credentials[0].matched = !v.credentials[0].matched)],
    ['aead', (v) => void (v.aead.channel[0].ciphertext = flip(v.aead.channel[0].ciphertext as string))],
    ['aead', (v) => void (v.aead.synthetic[7].tag = flip(v.aead.synthetic[7].tag as string))],
    ['packets', (v) => void (v.handshake.scenarios[0].conversation_frames[0].checksum = flip(v.handshake.scenarios[0].conversation_frames[0].checksum))],
    ['handshake', (v) => void (v.handshake.scenarios[0].noise.host_to_device_key = flip(v.handshake.scenarios[0].noise.host_to_device_key))],
    ['handshake', (v) => void (v.handshake.scenarios[1].noise.handshake_hash = flip(v.handshake.scenarios[1].noise.handshake_hash))],
    ['state replay', (v) => void (v.handshake.scenarios[1].conversation_frames[3].payload = flip(v.handshake.scenarios[1].conversation_frames[3].payload))],
  ];

  it.each(mutations.map(([group, mutate], i) => ({ group, mutate, i })))(
    'mutation $i is caught by $group',
    async ({ group, mutate }) => {
      const mutated = loadVectors();
      mutate(mutated);
      const report = runAllChecks(await loadBundle(), mutated).find((r) => r.group === group)!;
      expect(report.failures.length).toBeGreaterThan(0);
    },
  );
});
