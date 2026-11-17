import { describe, expect, it } from 'vitest';
import type { Account } from '@thru/sdk';
import {
  TickerFieldBuilder,
  TokenAccountBuilder,
  TokenMintAccountBuilder,
  TokenProgramAccount,
} from './abi/thru/program/token/types';
import { parseMintAccountData, parseTokenAccountData } from './accounts';

function key(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function wrap(kind: 'mint_v1' | 'token_account_v1', payload: Uint8Array): Uint8Array {
  return TokenProgramAccount.builder().payload().select(kind).writePayload(payload).finish().build();
}

function account(data: Uint8Array): Account {
  return { data: { data } } as unknown as Account;
}

function mintBytes(): Uint8Array {
  const ticker = new TickerFieldBuilder()
    .set_length(3)
    .set_bytes([0x54, 0x48, 0x52, 0, 0, 0, 0, 0])
    .build();
  return wrap('mint_v1', new TokenMintAccountBuilder()
    .set_decimals(9)
    .set_supply(1000n)
    .set_creator(key(1))
    .set_mint_authority(key(2))
    .set_freeze_authority(key(3))
    .set_has_freeze_authority(1)
    .set_ticker(ticker)
    .build());
}

function tokenAccountBytes(): Uint8Array {
  return wrap('token_account_v1', new TokenAccountBuilder()
    .set_mint(key(4))
    .set_owner(key(5))
    .set_amount(77n)
    .set_is_frozen(0)
    .build());
}

describe('token account decoding', () => {
  it('decodes mints and token accounts through the account root', () => {
    const mint = mintBytes();
    const tokenAccount = tokenAccountBytes();
    expect(mint).toHaveLength(116);
    expect(mint[0]).toBe(1);
    expect(tokenAccount).toHaveLength(74);
    expect(tokenAccount[0]).toBe(2);

    expect(parseMintAccountData(account(mint))).toMatchObject({
      decimals: 9,
      supply: 1000n,
      hasFreezeAuthority: true,
      ticker: 'THR',
    });
    expect(parseTokenAccountData(account(tokenAccount))).toMatchObject({
      amount: 77n,
      isFrozen: false,
    });
  });

  it('rejects the wrong account kind', () => {
    expect(() => parseTokenAccountData(account(mintBytes()))).toThrow(/not a token account/);
    expect(() => parseMintAccountData(account(tokenAccountBytes()))).toThrow(/not a token mint/);
  });

  it('rejects zeroed, truncated and padded data', () => {
    expect(() => parseTokenAccountData(account(new Uint8Array(74)))).toThrow(/not a token account/);
    expect(() => parseTokenAccountData(account(tokenAccountBytes().subarray(0, 73)))).toThrow(
      /not a token account/
    );
    const padded = new Uint8Array(117);
    padded.set(mintBytes());
    expect(() => parseMintAccountData(account(padded))).toThrow(/not a token mint/);
  });
});
