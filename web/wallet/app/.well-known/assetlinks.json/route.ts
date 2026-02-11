import { NextResponse } from 'next/server';

/**
 * Android Digital Asset Links — allows Android apps to use passkeys
 * created under the "wallet.thru.org" RP ID.
 *
 * Each Android app that shares passkeys must be listed with its
 * package name and signing certificate SHA-256 fingerprint.
 *
 * Get your fingerprint with:
 *   keytool -list -v -keystore your-keystore.jks | grep SHA256
 *
 * See: https://developer.android.com/identity/sign-in/credential-manager
 */

const assetLinks: Record<string, unknown>[] = [
  // TODO: Replace with your actual Android app details
  // {
  //   relation: [
  //     'delegate_permission/common.handle_all_urls',
  //     'delegate_permission/common.get_login_creds',
  //   ],
  //   target: {
  //     namespace: 'android_app',
  //     package_name: 'com.thru.mysterybox',
  //     sha256_cert_fingerprints: ['YOUR_SHA256_FINGERPRINT'],
  //   },
  // },
];

export async function GET() {
  return NextResponse.json(assetLinks, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
