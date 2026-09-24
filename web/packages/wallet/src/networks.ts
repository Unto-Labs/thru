/** Public network configuration. Custom destinations are never server proxy targets. */
export interface WalletNetworkPreset {
  slug: string;
  displayName: string;
  rpc: string;
}
export type WalletNetworkSelection = string | { rpcUrl: string; name?: string };
export interface ResolvedWalletNetwork {
  id: string;
  name: string;
  rpcUrl: string;
  /** Public wallet proxy for presets; absent for direct custom endpoints. */
  transportUrl?: string;
  chainId: number;
  transactionSigningScheme?: import("@thru/sdk").TransactionSigningScheme;
  scope: string;
  custom: boolean;
  /** A token destination is configured for this endpoint and chain, including faucet-only networks. */
  depositConfigured?: boolean;
  /** Providers explicitly configured for this endpoint and chain. */
  depositProviders?: string[];
}
export const DEFAULT_WALLET_NETWORKS: readonly WalletNetworkPreset[] = [
  {
    slug: "alphanet",
    displayName: "Alphanet",
    rpc: "https://rpc.alphanet.thru.org",
  },
  {
    slug: "betanet",
    displayName: "Betanet",
    rpc: "https://rpc.betanet.thru.org",
  },
];
export const NETWORK_SELECTION_PARAM = "tn_wallet_network";
export const NETWORK_CAPABILITY_PARAM = "tn_network_switching";
export const NETWORK_CHANGED_EVENT = "network_changed";
export const GET_NETWORK_REQUEST = "getNetwork";
export const SWITCH_NETWORK_REQUEST = "switchNetwork";

export function normalizeWalletRpc(value: string): string {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTP(S) RPC URL without credentials, query, or fragment.",
    );
  }
  return url.href.replace(/\/$/, "");
}
export function parseWalletNetworks(
  value?: string,
): readonly WalletNetworkPreset[] {
  if (value === undefined) return DEFAULT_WALLET_NETWORKS;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.length)
    throw new Error("WALLET_NETWORKS must be a nonempty array.");
  const slugs = new Set<string>();
  const urls = new Set<string>();
  return parsed.map((entry) => {
    if (
      !entry ||
      typeof entry.slug !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(entry.slug) ||
      entry.slug === "custom" ||
      typeof entry.displayName !== "string" ||
      !entry.displayName.trim() ||
      typeof entry.rpc !== "string"
    )
      throw new Error("Invalid WALLET_NETWORKS entry.");
    const rpc = normalizeWalletRpc(entry.rpc);
    if (slugs.has(entry.slug) || urls.has(rpc))
      throw new Error("Duplicate wallet network.");
    slugs.add(entry.slug);
    urls.add(rpc);
    return { slug: entry.slug, displayName: entry.displayName.trim(), rpc };
  });
}
export function resolveWalletNetworkSelection(
  selection: WalletNetworkSelection,
  presets: readonly WalletNetworkPreset[],
): Omit<ResolvedWalletNetwork, "chainId" | "scope"> {
  if (typeof selection === "string") {
    const preset = presets.find((p) => p.slug === selection);
    if (!preset) throw new Error(`Unknown wallet network: ${selection}`);
    return {
      id: preset.slug,
      name: preset.displayName,
      rpcUrl: normalizeWalletRpc(preset.rpc),
      custom: false,
    };
  }
  if (!selection || typeof selection.rpcUrl !== "string")
    throw new Error("Invalid wallet network selection.");
  if (selection.name !== undefined && typeof selection.name !== "string")
    throw new Error("Invalid network name.");
  const rpcUrl = normalizeWalletRpc(selection.rpcUrl);
  const preset = presets.find((p) => normalizeWalletRpc(p.rpc) === rpcUrl);
  return preset
    ? resolveWalletNetworkSelection(preset.slug, presets)
    : {
        id: "custom",
        name: selection.name?.trim() || "Custom",
        rpcUrl,
        custom: true,
      };
}
export function walletNetworkScope(
  network: { id: string; rpcUrl: string; custom: boolean },
  chainId: number,
): string {
  if (!Number.isInteger(chainId) || chainId < 1 || chainId > 65535)
    throw new Error("RPC returned an invalid chain ID.");
  return `${network.custom ? `custom:${normalizeWalletRpc(network.rpcUrl)}` : `preset:${network.id}`}:${chainId}`;
}
/** Custom aliases never replace the endpoint identity in user-facing labels. */
export function formatWalletNetworkLabel(network: {
  custom: boolean;
  rpcUrl: string;
  name?: string;
}): string {
  if (!network.custom) return network.name ?? "";
  let host: string;
  try {
    host = new URL(normalizeWalletRpc(network.rpcUrl)).host;
  } catch {
    return "Custom · invalid RPC URL";
  }
  const alias = network.name?.trim();
  return `Custom · ${host}${alias && alias !== "Custom" ? ` (${alias})` : ""}`;
}
/** One initial setting drives both SDK and wallet. The wallet validates runtime presets. */
export function withWalletNetwork(
  urlString: string,
  selection?: WalletNetworkSelection,
  rpcUrl?: string,
  appKey?: string,
): string {
  const url = new URL(urlString);
  url.searchParams.set(NETWORK_CAPABILITY_PARAM, "1");
  if (appKey) url.searchParams.set("tn_network_app", appKey);
  const legacy = url.searchParams.get("tn_default_rpc_url");
  const selected =
    selection ?? (rpcUrl || legacy ? { rpcUrl: rpcUrl || legacy! } : undefined);
  if (selected !== undefined) {
    if (typeof selected !== "string") normalizeWalletRpc(selected.rpcUrl);
    url.searchParams.set(NETWORK_SELECTION_PARAM, JSON.stringify(selected));
  }
  if (rpcUrl)
    url.searchParams.set("tn_expected_rpc", normalizeWalletRpc(rpcUrl));
  return url.toString();
}
export function networkStorageKey(key: string, scope: string): string {
  return `${key}.network.${Array.from(scope)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join("-")}`;
}
export function networkScopedStorage<
  T extends {
    getItem(key: string): any;
    setItem(key: string, value: string): any;
    removeItem(key: string): any;
  },
>(storage: T, scope: () => string): T {
  return {
    ...storage,
    networkScope: scope,
    getItem: (key: string) => storage.getItem(networkStorageKey(key, scope())),
    setItem: (key: string, value: string) =>
      storage.setItem(networkStorageKey(key, scope()), value),
    removeItem: (key: string) => {
      const target = networkStorageKey(key, scope());
      const legacy = storage.removeItem(key);
      const current = storage.removeItem(target);
      if (legacy || current)
        return Promise.all([legacy, current]).then(() => {});
    },
  } as T;
}
