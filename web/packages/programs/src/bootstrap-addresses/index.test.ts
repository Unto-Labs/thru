import { describe, expect, it } from 'vitest';

import { deriveManagedProgramAddresses } from '../manager';
import {
  BOOTSTRAP_PROGRAM_ADDRESSES,
  BOOTSTRAP_PROGRAM_SEEDS,
  CREDITS_MINT_ADDRESS,
  CREDITS_MINT_AUTHORITY_ADDRESS,
  CREDITS_MINT_SEED_HEX,
} from './index';
import { createThruClient } from '@thru/sdk/client';
import { deriveMintAddress } from '../token';

const EXPECTED_ADDRESSES = {
  noop: 'ta48QIbkvBw1wIeVkFpWwOq8nGdu0uMLvMMHCgIvYZo6qG',
  faucet: 'taWpJIo6Ez5_3QdzfDiaj5Ppq5smU-pLftQD9Rkg8jrgdx',
  name_service: 'taLhNfLFi8p6hqNg3JGcnNuuuhWM7rcLRGSF7qEZbBuWIo',
  oracle: 'taQlmNDxbXJUeInC24XEAhKw66BpqtcAraLMeA4PgBwPTq',
  multicall: 'tatPH9XJbriBMntQG_GU6r4YWZCcco1wEGgPw2gY3iFaj8',
  abi_manager: 'tarnqUz4l-LKmRchPuw_YxLetE17HSq-KK8My4RdCYyzZE',
  token: 'tazba_zSI-DTiFPvtpLNo_dDkuAWaY1sWX0VeHu_d44RH3',
  amm: 'tapCRj8RCYWSaG_NQO4Oyl8VjGTKkVkTXJAN4ERrDMnz9C',
  clob: 'ta82hwN3KNQJKXdTq7nX347ajiKDBg04cbcqsUas5NEY3e',
  thru_registrar: 'taTbSR9Cb4xzC7lLtnEMwTFLuUkSEqwzH4FtWWvCInoflG',
  wthru: 'taJ4Z3Mz4prd3yuLFmoyGbNHfWLlpfyzUmNn9k-9UemJIn',
  passkey_manager: 'taPPDWMTxzvQyA1jOO4fdHU_dOhBpOlpzItJsvf2vaIi3w',
  nft: 'taVRt8dNq3B1IGXWpYx17GWEfFcpmU8LF9uWy75XIIcA03',
  block_producer: 'ta66mgj0z_nzqJZURi_1OFWMnkAZWK7h7fOy8ry2MCi4o8',
  consensus_validator: 'tapezQswb_GBLkEPDzdn3F0YFntwbTk-8z7hwAY8slYHL_',
} as const;

describe('bootstrap-managed program addresses', () => {
  it('matches the canonical deployed address registry', () => {
    expect(BOOTSTRAP_PROGRAM_ADDRESSES).toEqual(EXPECTED_ADDRESSES);
  });

  it('derives every address from its permanent bootstrap seed', () => {
    for (const name of Object.keys(BOOTSTRAP_PROGRAM_SEEDS) as Array<
      keyof typeof BOOTSTRAP_PROGRAM_SEEDS
    >) {
      expect(
        deriveManagedProgramAddresses(BOOTSTRAP_PROGRAM_SEEDS[name])
          .programAccountAddress,
      ).toBe(BOOTSTRAP_PROGRAM_ADDRESSES[name]);
    }
  });

  it('derives the canonical CREDITS mint under managed Token', () => {
    const client = createThruClient({ baseUrl: 'https://rpc.test' });
    expect(
      deriveMintAddress(
        client,
        CREDITS_MINT_AUTHORITY_ADDRESS,
        CREDITS_MINT_SEED_HEX,
        BOOTSTRAP_PROGRAM_ADDRESSES.token,
      ).address,
    ).toBe(CREDITS_MINT_ADDRESS);
  });
});
