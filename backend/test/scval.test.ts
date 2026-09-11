import { describe, it, expect } from 'vitest';
import { encodeArg } from '../src/services/soroban';

const ADDRESS = 'GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6';
const CONTRACT = 'CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT';

describe('encodeArg', () => {
  it('encodes an address account and contract distinctly', () => {
    const account = encodeArg({ type: 'address', value: ADDRESS });
    expect(account.switch().name).toBe('scvAddress');
    expect(account.address().switch().name).toBe('scAddressTypeAccount');

    const contract = encodeArg({ type: 'address', value: CONTRACT });
    expect(contract.address().switch().name).toBe('scAddressTypeContract');
  });

  it('rejects a malformed address', () => {
    expect(() => encodeArg({ type: 'address', value: 'not-an-address' })).toThrow();
  });

  it('encodes i128 with correct hi/lo parts', () => {
    const val = encodeArg({ type: 'i128', value: '500' });
    expect(val.switch().name).toBe('scvI128');
    expect(val.i128().lo().toString()).toBe('500');
    expect(val.i128().hi().toString()).toBe('0');
  });

  it('encodes u32 and enforces its bounds', () => {
    expect(encodeArg({ type: 'u32', value: 7 }).u32()).toBe(7);
    expect(encodeArg({ type: 'u32', value: '7' }).u32()).toBe(7);
    expect(() => encodeArg({ type: 'u32', value: -1 })).toThrow();
    expect(() => encodeArg({ type: 'u32', value: 2 ** 33 })).toThrow();
    expect(() => encodeArg({ type: 'u32', value: 1.5 })).toThrow();
  });

  it('encodes u64 and enforces its bounds', () => {
    expect(encodeArg({ type: 'u64', value: '42' }).u64().toString()).toBe('42');
    expect(() => encodeArg({ type: 'u64', value: '-1' })).toThrow();
    expect(() => encodeArg({ type: 'u64', value: (2n ** 64n).toString() })).toThrow();
  });

  it('encodes booleans', () => {
    expect(encodeArg({ type: 'bool', value: true }).b()).toBe(true);
    expect(encodeArg({ type: 'bool', value: false }).b()).toBe(false);
  });

  it('encodes Option as Void or the inner value', () => {
    expect(encodeArg({ type: 'option', value: null }).switch().name).toBe('scvVoid');
    const some = encodeArg({ type: 'option', value: { type: 'string', value: 'x' } });
    expect(some.str().toString()).toBe('x');
  });

  it('encodes a contract-type enum as Vec[Symbol(variant), ...fields]', () => {
    const val = encodeArg({
      type: 'enum',
      variant: 'Release',
      value: [
        { type: 'string', value: 'issue-1' },
        { type: 'u32', value: 2 },
      ],
    });
    expect(val.switch().name).toBe('scvVec');
    const vec = val.vec() ?? [];
    expect(vec).toHaveLength(3);
    expect(vec[0].sym().toString()).toBe('Release');
    expect(vec[1].str().toString()).toBe('issue-1');
    expect(vec[2].u32()).toBe(2);
  });

  // NOTE: this is the representation for a data-bearing enum's variant. An
  // enum where every variant carries an explicit integer discriminant (e.g.
  // `ReviewDecision { Approve = 0, Reject = 1 }`) is encoded as a u32 instead
  // and must be passed to `encodeArg` as `{ type: 'u32' }` (see the relay).
  it('encodes a unit variant of a symbol-vec enum as Vec[Symbol(variant)]', () => {
    const val = encodeArg({ type: 'enum', variant: 'Approve', value: [] });
    const vec = val.vec() ?? [];
    expect(vec).toHaveLength(1);
    expect(vec[0].sym().toString()).toBe('Approve');
  });

  it('encodes a struct as a Map of field-name symbols', () => {
    const val = encodeArg({
      type: 'struct',
      value: {
        title: { type: 'string', value: 'Research' },
        amount: { type: 'i128', value: '100' },
        settled: { type: 'bool', value: false },
      },
    });
    expect(val.switch().name).toBe('scvMap');
    const entries = val.map() ?? [];
    expect(entries.map((e) => e.key().sym().toString())).toEqual(['title', 'amount', 'settled']);
    expect(entries[1].val().i128().lo().toString()).toBe('100');
  });

  it('encodes nested vectors', () => {
    const val = encodeArg({
      type: 'vec',
      value: [
        { type: 'address', value: ADDRESS },
        { type: 'address', value: CONTRACT },
      ],
    });
    expect(val.vec()).toHaveLength(2);
  });
});
