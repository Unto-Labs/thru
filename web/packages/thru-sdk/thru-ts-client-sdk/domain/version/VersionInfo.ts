import type { GetVersionResponse } from "../../proto/thru/services/v1/query_service_pb";

export class VersionInfo {
    readonly components: Record<string, string>;

    constructor(components: Record<string, string>) {
        this.components = { ...components };
    }

    static fromProto(proto: GetVersionResponse): VersionInfo {
        return new VersionInfo(proto.versions ?? {});
    }

    get(component: string): string | undefined {
        return this.components[component];
    }
}

