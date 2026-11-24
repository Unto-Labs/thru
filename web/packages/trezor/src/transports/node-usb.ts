/**
 * A real Trezor from Node, through the optional native package `usb` (version
 * 3, which has a WebUSB implementation): it is loaded with a dynamic import
 * when it is first needed, so that nothing else needs it installed, and it
 * offers the WebUSB interface, so the WebUSB transport (`./webusb`) is reused
 * as it is.
 *
 * Loading the package does not list devices; `getDevices` (called when a
 * transport is opened) does. Node has no picker: the one Trezor firmware that
 * is connected is used, and several are an error, as in the Rust host.
 */
import {
  pickDevice,
  reopenWebUsbTransport,
  requestWebUsbTransport,
  UsbTransportError,
  type UsbDeviceLike,
  type UsbLike,
  type WebUsbOptions,
  type WebUsbTransport,
} from './webusb';

/** The package this entry loads. */
export const NODE_USB_PACKAGE = 'usb';

/** The part of the `usb` package's WebUSB object that this entry uses. */
export type NodeUsbWebUsb = { getDevices(): Promise<UsbDeviceLike[]> };

/** The part of the `usb` package this entry uses (`WebUSB`, or its ready-made `usb`). */
export type NodeUsbModule = {
  WebUSB?: new (options: { allowAllDevices?: boolean }) => NodeUsbWebUsb;
  usb?: NodeUsbWebUsb;
  default?: { WebUSB?: NodeUsbModule['WebUSB']; usb?: NodeUsbWebUsb };
};

export type NodeUsbOptions = {
  /** The module to use instead of importing `usb` (tests). */
  module?: NodeUsbModule;
  /** The package to import instead of `usb` (a test of the missing package). */
  packageName?: string;
};

async function loadModule(packageName: string): Promise<NodeUsbModule> {
  try {
    return (await import(/* @vite-ignore */ packageName)) as NodeUsbModule;
  } catch (error) {
    throw new UsbTransportError(
      'unsupported',
      `the optional package "${packageName}" is not installed, or has no binary for this system; install it with: pnpm add ${packageName}`,
      { cause: error },
    );
  }
}

/**
 * The WebUSB interface of the `usb` package, for the WebUSB transport. Every
 * device the system lists is allowed (a Node program is not a web page);
 * `requestDevice` takes the one connected Trezor, with no picker.
 */
export async function createNodeUsb(options: NodeUsbOptions = {}): Promise<UsbLike> {
  const module = options.module ?? (await loadModule(options.packageName ?? NODE_USB_PACKAGE));
  const WebUSB = module.WebUSB ?? module.default?.WebUSB;
  const webusb = WebUSB ? new WebUSB({ allowAllDevices: true }) : (module.usb ?? module.default?.usb);
  if (!webusb) {
    throw new UsbTransportError('unsupported', `the package "${NODE_USB_PACKAGE}" has no WebUSB interface: install version 3 or later`);
  }
  return {
    getDevices: () => webusb.getDevices(),
    requestDevice: async () => pickDevice(await webusb.getDevices()),
  };
}

/** Opens the one Trezor firmware that is connected. */
export async function openNodeUsbTransport(options: NodeUsbOptions & Omit<WebUsbOptions, 'usb'> = {}): Promise<WebUsbTransport> {
  const { module, packageName, ...rest } = options;
  return reopenWebUsbTransport({ ...rest, usb: await createNodeUsb({ module, packageName }) });
}

/** As {@link openNodeUsbTransport}; the name matches the browser's `requestWebUsbTransport`. */
export async function requestNodeUsbTransport(options: NodeUsbOptions & Omit<WebUsbOptions, 'usb'> = {}): Promise<WebUsbTransport> {
  const { module, packageName, ...rest } = options;
  return requestWebUsbTransport({ ...rest, usb: await createNodeUsb({ module, packageName }) });
}
