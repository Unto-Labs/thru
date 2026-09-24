import {
  createRequestId,
  type NetworkOperationRequestMessage,
} from './protocol';

interface OperationBridge {
  supportsNetworkSwitching(): boolean;
  sendMessage(request: NetworkOperationRequestMessage): Promise<unknown>;
}

/** Keep the wallet's Settings switch locked through SDK-side submission and
 * deposit polling, including the gaps between individual bridge requests. */
export async function withNetworkOperation<T>(
  bridge: OperationBridge,
  origin: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!bridge.supportsNetworkSwitching?.()) return operation();
  const operationId = createRequestId();
  const notify = (busy: boolean) =>
    bridge.sendMessage({
      id: createRequestId(),
      type: 'networkOperation',
      payload: { operationId, busy },
      origin,
    });
  await notify(true);
  try {
    return await operation();
  } finally {
    await notify(false).catch(() => {});
  }
}
