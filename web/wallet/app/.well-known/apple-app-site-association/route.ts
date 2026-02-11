import { NextResponse } from 'next/server';

/**
 * Apple App Site Association — allows iOS apps to use passkeys
 * created under the "wallet.thru.org" RP ID.
 *
 * Each iOS app that shares passkeys must be listed here as:
 *   "TEAM_ID.bundle.identifier"
 *
 * See: https://developer.apple.com/documentation/bundleresources/applinks
 */

const association = {
  webcredentials: {
    apps: [
      '6M9CY3SWST.com.untolabs.sweep',
    ],
  },
};

export async function GET() {
  return NextResponse.json(association, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
