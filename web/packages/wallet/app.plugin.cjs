/* Expo entrypoint for the config plugin. Keep this file dependency-free so
   Expo can load it from a clean workspace before package build artifacts exist. */

const DEFAULT_RP_DOMAIN = "wallet.thru.org";
const APP_BOUND_DOMAIN_CAP = 10;
const MIN_ANDROID_SDK_FOR_PASSKEYS = 28;
const ANDROID_SYSTEM_BRIGHTNESS_PERMISSION =
  "android.permission.WRITE_SETTINGS";
const IOS_ASSOCIATED_DOMAIN_MODES = new Set([
  "developer",
  "managed",
  "developer+managed",
]);

const ANDROID_CREDENTIAL_MANAGER_DEPS = [
  "androidx.credentials:credentials:1.5.0",
  "androidx.credentials:credentials-play-services-auth:1.5.0",
  "androidx.webkit:webkit:1.14.0",
];

function withThruWalletNative(config, opts = {}) {
  const rpDomain = opts.rpDomain || DEFAULT_RP_DOMAIN;
  const associatedDomainMode = opts.iosAssociatedDomainMode;
  if (
    associatedDomainMode &&
    !IOS_ASSOCIATED_DOMAIN_MODES.has(associatedDomainMode)
  ) {
    throw new Error(
      `[@thru/wallet/native/plugin] Invalid iosAssociatedDomainMode "${associatedDomainMode}". Expected developer, managed, or developer+managed.`,
    );
  }

  if (!config.ios) config.ios = {};
  if (!config.ios.infoPlist) config.ios.infoPlist = {};

  const existingAppBoundDomains = Array.isArray(
    config.ios.infoPlist.WKAppBoundDomains,
  )
    ? config.ios.infoPlist.WKAppBoundDomains
    : [];
  if (!existingAppBoundDomains.includes(rpDomain)) {
    if (existingAppBoundDomains.length >= APP_BOUND_DOMAIN_CAP) {
      throw new Error(
        `[@thru/wallet/native/plugin] WKAppBoundDomains is capped at ${APP_BOUND_DOMAIN_CAP} entries; cannot add ${rpDomain}. Drop an unused domain from your Info.plist before adding the wallet.`,
      );
    }
    config.ios.infoPlist.WKAppBoundDomains = [
      ...existingAppBoundDomains,
      rpDomain,
    ];
  }

  const webCredentialsDomain = associatedDomainMode
    ? `webcredentials:${rpDomain}?mode=${associatedDomainMode}`
    : `webcredentials:${rpDomain}`;
  const associatedDomains = Array.isArray(config.ios.associatedDomains)
    ? config.ios.associatedDomains
    : [];
  if (!associatedDomains.includes(webCredentialsDomain)) {
    config.ios.associatedDomains = [
      ...associatedDomains,
      webCredentialsDomain,
    ];
  }

  if (!config.android) config.android = {};
  const currentMin = config.android.minSdkVersion || 0;
  if (currentMin < MIN_ANDROID_SDK_FOR_PASSKEYS) {
    config.android.minSdkVersion = MIN_ANDROID_SDK_FOR_PASSKEYS;
  }

  const existingPermissions = Array.isArray(config.android.permissions)
    ? config.android.permissions.slice()
    : [];
  if (!existingPermissions.includes(ANDROID_SYSTEM_BRIGHTNESS_PERMISSION)) {
    existingPermissions.push(ANDROID_SYSTEM_BRIGHTNESS_PERMISSION);
  }
  config.android.permissions = existingPermissions;

  const existingDeps = Array.isArray(config.android.extraDependencies)
    ? config.android.extraDependencies.slice()
    : [];
  for (const dep of ANDROID_CREDENTIAL_MANAGER_DEPS) {
    if (!existingDeps.includes(dep)) existingDeps.push(dep);
  }
  config.android.extraDependencies = existingDeps;

  config.android.extraProguardRules = [
    config.android.extraProguardRules,
    "-keep class androidx.credentials.** { *; }",
    "-keep class androidx.webkit.** { *; }",
    "-keep class com.google.android.gms.fido.** { *; }",
  ]
    .filter(Boolean)
    .join("\n");

  return config;
}

module.exports = withThruWalletNative;
module.exports.default = withThruWalletNative;
