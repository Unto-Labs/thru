import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

import type * as NodeUsbModuleApi from '../../node-usb';
import type * as WebUsbApi from '../../webusb';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/** The built browser USB entry (`pnpm build` first), loaded in Node. */
export async function loadWebUsb(): Promise<typeof WebUsbApi> {
  return (await import(/* @vite-ignore */ pathToFileURL(here('../../../dist/webusb.js')).href)) as typeof WebUsbApi;
}

/** The built Node USB entry, loaded in Node. It does not load the `usb` package until it is asked to. */
export async function loadNodeUsb(): Promise<typeof NodeUsbModuleApi> {
  return (await import(/* @vite-ignore */ pathToFileURL(here('../../../dist/node-usb.js')).href)) as typeof NodeUsbModuleApi;
}
