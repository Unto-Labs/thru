import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithReadableBody } from "./rpc";

describe("fetchWithReadableBody", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("provides a readable body when the native response omits one", async () => {
    const bytes = new TextEncoder().encode("grpc response");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        body: null,
        headers: new Headers(),
        ok: true,
        redirected: false,
        status: 200,
        statusText: "OK",
        type: "default",
        url: "http://rpc.test",
        arrayBuffer: async () => bytes.buffer,
      }),
    );

    const response = await fetchWithReadableBody("http://rpc.test");

    expect(await new Response(response.body).text()).toBe("grpc response");
  });
});
