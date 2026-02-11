export function resolveThruRpcBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_RPC_URL?.trim();
  return url || '/api/grpc';
}
