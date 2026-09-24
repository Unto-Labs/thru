import { describe, expect, it, vi } from 'vitest';
import { withNetworkOperation } from './network-operations';

describe('network operation lock', () => {
  it('waits for the wallet lock and releases it even when submission fails', async () => {
    let acknowledge!: () => void;
    const sendMessage = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            acknowledge = resolve;
          }),
      )
      .mockResolvedValue({});
    const operation = vi.fn(async () => {
      throw new Error('submission failed');
    });
    const pending = withNetworkOperation(
      { supportsNetworkSwitching: () => true, sendMessage },
      'app://test',
      operation,
    );
    expect(operation).not.toHaveBeenCalled();
    acknowledge();
    await expect(pending).rejects.toThrow('submission failed');
    const [start, end] = sendMessage.mock.calls.map(([message]) => message);
    expect(start.payload.busy).toBe(true);
    expect(end.payload).toEqual({
      operationId: start.payload.operationId,
      busy: false,
    });
  });
  it('does not execute an operation when switching has already begun', async () => {
    const operation = vi.fn(async () => {});
    const bridge = {
      supportsNetworkSwitching: () => true,
      sendMessage: vi.fn().mockRejectedValue(new Error('NETWORK_CHANGED')),
    };
    await expect(
      withNetworkOperation(bridge, 'app://test', operation),
    ).rejects.toThrow('NETWORK_CHANGED');
    expect(operation).not.toHaveBeenCalled();
  });
  it('preserves the old protocol when switching is unavailable', async () => {
    const sendMessage = vi.fn();
    const result = await withNetworkOperation(
      { supportsNetworkSwitching: () => false, sendMessage },
      'app://test',
      async () => 'done',
    );
    expect(result).toBe('done');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
