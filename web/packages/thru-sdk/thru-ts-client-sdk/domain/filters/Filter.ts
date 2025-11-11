import { create } from "@bufbuild/protobuf";

import {
    FilterParamValueSchema,
    FilterSchema,
    Filter as ProtoFilter,
    FilterParamValue as ProtoFilterParamValue,
} from "../../proto/thru/common/v1/filters_pb";

export type FilterParamValueCase =
    | "stringValue"
    | "bytesValue"
    | "boolValue"
    | "intValue"
    | "doubleValue";

function copyBytes(source: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(source.length);
    bytes.set(source);
    return bytes;
}

export class FilterParamValue {
    private readonly case?: FilterParamValueCase;
    private readonly value?: string | Uint8Array | boolean | bigint | number;

    private constructor(params: {
        case?: FilterParamValueCase;
        value?: string | Uint8Array | boolean | bigint | number;
    }) {
        this.case = params.case;

        if (!params.case) {
            this.value = undefined;
            return;
        }

        switch (params.case) {
            case "stringValue":
                if (typeof params.value !== "string") {
                    throw new Error("FilterParamValue.string requires a string value");
                }
                this.value = params.value;
                return;
            case "bytesValue":
                if (!(params.value instanceof Uint8Array)) {
                    throw new Error("FilterParamValue.bytes requires a Uint8Array value");
                }
                this.value = copyBytes(params.value);
                return;
            case "boolValue":
                if (typeof params.value !== "boolean") {
                    throw new Error("FilterParamValue.bool requires a boolean value");
                }
                this.value = params.value;
                return;
            case "intValue":
                if (typeof params.value !== "bigint") {
                    throw new Error("FilterParamValue.int requires a bigint value");
                }
                this.value = params.value;
                return;
            case "doubleValue":
                if (typeof params.value !== "number") {
                    throw new Error("FilterParamValue.double requires a number value");
                }
                this.value = params.value;
                return;
            default:
                this.value = undefined;
        }
    }

    static none(): FilterParamValue {
        return new FilterParamValue({});
    }

    static string(value: string): FilterParamValue {
        return new FilterParamValue({ case: "stringValue", value });
    }

    static bytes(value: Uint8Array): FilterParamValue {
        return new FilterParamValue({ case: "bytesValue", value });
    }

    static bool(value: boolean): FilterParamValue {
        return new FilterParamValue({ case: "boolValue", value });
    }

    static int(value: bigint): FilterParamValue {
        return new FilterParamValue({ case: "intValue", value });
    }

    static double(value: number): FilterParamValue {
        if (!Number.isFinite(value)) {
            throw new Error("FilterParamValue.double requires a finite number");
        }
        return new FilterParamValue({ case: "doubleValue", value });
    }

    static fromProto(proto: ProtoFilterParamValue): FilterParamValue {
        const kind = proto.kind;
        if (!kind.case) {
            return FilterParamValue.none();
        }

        switch (kind.case) {
            case "stringValue":
                return FilterParamValue.string(kind.value);
            case "bytesValue":
                return FilterParamValue.bytes(kind.value);
            case "boolValue":
                return FilterParamValue.bool(kind.value);
            case "intValue":
                return FilterParamValue.int(kind.value);
            case "doubleValue":
                return FilterParamValue.double(kind.value);
            default:
                return FilterParamValue.none();
        }
    }

    toProto(): ProtoFilterParamValue {
        if (!this.case) {
            return create(FilterParamValueSchema);
        }

        switch (this.case) {
            case "stringValue":
                return create(FilterParamValueSchema, {
                    kind: {
                        case: "stringValue",
                        value: this.value as string,
                    },
                });
            case "bytesValue":
                return create(FilterParamValueSchema, {
                    kind: {
                        case: "bytesValue",
                        value: copyBytes(this.value as Uint8Array),
                    },
                });
            case "boolValue":
                return create(FilterParamValueSchema, {
                    kind: {
                        case: "boolValue",
                        value: this.value as boolean,
                    },
                });
            case "intValue":
                return create(FilterParamValueSchema, {
                    kind: {
                        case: "intValue",
                        value: this.value as bigint,
                    },
                });
            case "doubleValue":
                return create(FilterParamValueSchema, {
                    kind: {
                        case: "doubleValue",
                        value: this.value as number,
                    },
                });
            default:
                throw new Error("FilterParamValue has an unknown kind");
        }
    }

    getCase(): FilterParamValueCase | undefined {
        return this.case;
    }

    getString(): string | undefined {
        return this.case === "stringValue" ? (this.value as string) : undefined;
    }

    getBytes(): Uint8Array | undefined {
        if (this.case !== "bytesValue" || !(this.value instanceof Uint8Array)) {
            return undefined;
        }
        return copyBytes(this.value);
    }

    getBool(): boolean | undefined {
        return this.case === "boolValue" ? (this.value as boolean) : undefined;
    }

    getInt(): bigint | undefined {
        return this.case === "intValue" ? (this.value as bigint) : undefined;
    }

    getDouble(): number | undefined {
        return this.case === "doubleValue" ? (this.value as number) : undefined;
    }
}

export interface FilterParamsInit {
    [key: string]: FilterParamValue;
}

export class Filter {
    readonly expression?: string;
    private readonly params: Map<string, FilterParamValue>;

    constructor(init: { expression?: string; params?: FilterParamsInit | Map<string, FilterParamValue> | Iterable<[string, FilterParamValue]> } = {}) {
        this.expression = init.expression;
        this.params = new Map();

        if (!init.params) {
            return;
        }

        if (init.params instanceof Map) {
            for (const [key, value] of init.params.entries()) {
                this.setParamInternal(key, value);
            }
            return;
        }

        if (typeof (init.params as FilterParamsInit) === "object" && !Array.isArray(init.params)) {
            for (const [key, value] of Object.entries(init.params as FilterParamsInit)) {
                this.setParamInternal(key, value);
            }
            return;
        }

        for (const [key, value] of init.params as Iterable<[string, FilterParamValue]>) {
            this.setParamInternal(key, value);
        }
    }

    static fromProto(proto: ProtoFilter): Filter {
        const params = Object.entries(proto.params ?? {}).map(([key, value]) => [key, FilterParamValue.fromProto(value)] as [string, FilterParamValue]);
        return new Filter({
            expression: proto.expression,
            params,
        });
    }

    toProto(): ProtoFilter {
        const protoParams: { [key: string]: ProtoFilterParamValue } = {};
        for (const [key, value] of this.params.entries()) {
            protoParams[key] = value.toProto();
        }

        return create(FilterSchema, {
            expression: this.expression,
            params: protoParams,
        });
    }

    hasParam(name: string): boolean {
        return this.params.has(name);
    }

    getParam(name: string): FilterParamValue | undefined {
        const param = this.params.get(name);
        return param;
    }

    listParams(): string[] {
        return Array.from(this.params.keys());
    }

    entries(): [string, FilterParamValue][] {
        return Array.from(this.params.entries());
    }

    withExpression(expression?: string): Filter {
        return new Filter({ expression, params: this.params });
    }

    withParam(name: string, value: FilterParamValue): Filter {
        const params = new Map(this.params);
        params.set(name, value);
        return new Filter({ expression: this.expression, params });
    }

    withoutParam(name: string): Filter {
        if (!this.params.has(name)) {
            return this;
        }
        const params = new Map(this.params);
        params.delete(name);
        return new Filter({ expression: this.expression, params });
    }

    private setParamInternal(name: string, value: FilterParamValue): void {
        if (!(value instanceof FilterParamValue)) {
            throw new Error(`Filter parameter "${name}" must be a FilterParamValue`);
        }
        this.params.set(name, value);
    }
}


