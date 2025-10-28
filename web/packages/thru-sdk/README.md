whenever there are new protos
- update the proto directory with new .proto files
- run `pnpm --filter @thru/thru-sdk protobufs:pull`
- run `pnpm --filter @thru/thru-sdk protobufs:generate`
- run `pnpm --filter @thru/thru-sdk build`

publish the package or do whatever local dev you want