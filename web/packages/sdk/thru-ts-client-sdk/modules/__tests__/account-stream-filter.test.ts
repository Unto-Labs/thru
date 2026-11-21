import { describe, expect, it, vi } from "vitest";
import { createThruClientContext } from "../../core/client";
import { Filter, FilterParamValue } from "../../domain/filters";
import { streamAccountUpdates } from "../streaming";

function captureStream() {
  const ctx = createThruClientContext({ baseUrl: "https://unused.invalid" });
  const stream = vi.spyOn(ctx.streaming, "streamAccountUpdates").mockReturnValue(
    (async function* () {})(),
  );
  return { ctx, stream };
}

describe("account stream filter parameters", () => {
  const address = new Uint8Array(32).fill(1);
  const otherAddress = new Uint8Array(32).fill(2);

  it("keeps the address predicate when no user filter is provided", () => {
    const { ctx, stream } = captureStream();

    streamAccountUpdates(ctx, address);

    expect(stream.mock.calls[0][0].filter).toEqual(new Filter({
      expression: "account_address.value == params.address",
      params: { address: FilterParamValue.bytes(address) },
    }).toProto());
  });

  const filterCases: {
    name: string;
    params: Record<string, FilterParamValue>;
    binding: string;
  }[] = [
    { name: "a distinct name", params: { owner: FilterParamValue.bytes(otherAddress) }, binding: "address" },
    { name: "address", params: { address: FilterParamValue.bytes(otherAddress) }, binding: "address_1" },
    {
      name: "several candidate names",
      params: {
        address: FilterParamValue.bytes(otherAddress),
        address_1: FilterParamValue.string("owner"),
        address_2: FilterParamValue.uint(3n),
      },
      binding: "address_3",
    },
    { name: "an unused suffix", params: { address_1: FilterParamValue.bool(true) }, binding: "address" },
  ];

  it.each(filterCases)("preserves both predicates when the user binds $name", ({ params, binding }) => {
    const { ctx, stream } = captureStream();
    const expression = Object.keys(params).map((key) => `params.${key} == params.${key}`).join(" && ");
    const filter = new Filter({ expression, params });
    const original = filter.toProto();

    streamAccountUpdates(ctx, address, { filter });

    expect(stream.mock.calls[0][0].filter).toEqual(new Filter({
      expression: `(account_address.value == params.${binding}) && (${expression})`,
      params: { ...params, [binding]: FilterParamValue.bytes(address) },
    }).toProto());
    expect(filter.toProto()).toEqual(original);
  });
});
