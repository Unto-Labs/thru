import { createThruClient, type Thru } from "@thru/sdk/client";

function responseBodyFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** React Native's fetch can omit Response.body even when arrayBuffer() works. */
export async function fetchWithReadableBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.body) return response;

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    body: responseBodyFromBytes(bytes),
    headers: response.headers,
    ok: response.ok,
    redirected: response.redirected,
    status: response.status,
    statusText: response.statusText,
    type: response.type,
    url: response.url,
  } as Response;
}

export function createNativeThruClient(rpcUrl?: string): Thru {
  return createThruClient({
    ...(rpcUrl ? { baseUrl: rpcUrl } : {}),
    transportOptions: { fetch: fetchWithReadableBody },
  });
}
