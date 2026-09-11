import { describe, it, expect, afterEach, vi } from 'vitest';
import { connectWallet, isFreighterAvailable, signTransactionXdr } from '../lib/wallet';

type FakeWindow = typeof window & { freighterApi?: unknown };
const fakeWindow = window as FakeWindow;

afterEach(() => {
  delete fakeWindow.freighterApi;
  vi.restoreAllMocks();
});

describe('signTransactionXdr (Freighter response shapes)', () => {
  it('returns signedTxXdr from the current documented API shape', async () => {
    fakeWindow.freighterApi = {
      signTransaction: vi
        .fn()
        .mockResolvedValue({ signedTxXdr: 'SIGNED-XDR', signerAddress: 'GABC' }),
    };
    await expect(signTransactionXdr('XDR', 'PASS')).resolves.toBe('SIGNED-XDR');
  });

  it('accepts the legacy raw-string response', async () => {
    fakeWindow.freighterApi = { signTransaction: vi.fn().mockResolvedValue('LEGACY-XDR') };
    await expect(signTransactionXdr('XDR', 'PASS')).resolves.toBe('LEGACY-XDR');
  });

  it('surfaces a returned error instead of reporting a cancellation', async () => {
    fakeWindow.freighterApi = {
      signTransaction: vi
        .fn()
        .mockResolvedValue({ error: { message: 'The user rejected this request.' } }),
    };
    await expect(signTransactionXdr('XDR', 'PASS')).rejects.toThrow(/user rejected/i);
  });

  it('throws a clear error when no signed payload is returned', async () => {
    fakeWindow.freighterApi = { signTransaction: vi.fn().mockResolvedValue({}) };
    await expect(signTransactionXdr('XDR', 'PASS')).rejects.toThrow(/did not return a signed/);
  });

  it('throws when Freighter is unavailable', async () => {
    await expect(signTransactionXdr('XDR', 'PASS')).rejects.toThrow(/not available/i);
  });
});

describe('connectWallet', () => {
  it('reads the address from the current shape after an isConnected check', async () => {
    fakeWindow.freighterApi = {
      isConnected: vi.fn().mockResolvedValue({ isConnected: true }),
      getAddress: vi.fn().mockResolvedValue({ address: 'GABC' }),
    };
    await expect(connectWallet()).resolves.toEqual({ address: 'GABC' });
  });

  it('rejects when the wallet reports it is not connected', async () => {
    fakeWindow.freighterApi = {
      isConnected: vi.fn().mockResolvedValue({ isConnected: false }),
      getAddress: vi.fn(),
    };
    await expect(connectWallet()).rejects.toThrow(/locked or not connected/i);
  });

  it('errors clearly when Freighter is not installed', async () => {
    await expect(connectWallet()).rejects.toThrow(/not installed/i);
  });
});

describe('isFreighterAvailable', () => {
  it('reflects the injected global', () => {
    expect(isFreighterAvailable()).toBe(false);
    fakeWindow.freighterApi = {};
    expect(isFreighterAvailable()).toBe(true);
  });
});
