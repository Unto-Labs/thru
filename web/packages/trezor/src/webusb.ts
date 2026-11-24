/**
 * `@thru/trezor/webusb`: what a browser page needs to reach a Trezor over USB
 * and to keep its pairing credential. The WebUSB transport (Chromium browsers
 * only; the picker needs a click), and the IndexedDB credential store. It holds
 * no driver and no Node built-in, and is not reachable from the other entries.
 */
export {
  CLOSE_TIMEOUT_MS,
  isWebUsbSupported,
  pickDevice,
  reopenWebUsbTransport,
  requestWebUsbTransport,
  TREZOR_USB_BOOTLOADER_PRODUCT_ID,
  TREZOR_USB_ENDPOINT,
  TREZOR_USB_FILTERS,
  TREZOR_USB_INTERFACE,
  TREZOR_USB_PRODUCT_ID,
  TREZOR_USB_VENDOR_ID,
  UsbTransportError,
  WebUsbTransport,
  WRITE_TIMEOUT_MS,
  type UsbConfigurationLike,
  type UsbDeviceLike,
  type UsbEndpointLike,
  type UsbFilter,
  type UsbInResultLike,
  type UsbInterfaceLike,
  type UsbLike,
  type UsbOutResultLike,
  type WebUsbOptions,
} from './transports/webusb';
export {
  CREDENTIAL_DATABASE,
  IndexedDbCredentialError,
  IndexedDbCredentialStore,
  type IndexedDbCredentialStoreOptions,
} from './credentials-indexeddb';
