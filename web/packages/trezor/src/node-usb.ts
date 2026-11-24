/**
 * `@thru/trezor/node-usb`: a real Trezor from Node (scripts, command-line
 * tools), through the optional native package `usb`, plus the credential
 * file. Node only: it is not reachable from the browser entries.
 */
export {
  createNodeUsb,
  NODE_USB_PACKAGE,
  openNodeUsbTransport,
  requestNodeUsbTransport,
  type NodeUsbModule,
  type NodeUsbOptions,
  type NodeUsbWebUsb,
} from './transports/node-usb';
export {
  pickDevice,
  TREZOR_USB_BOOTLOADER_PRODUCT_ID,
  TREZOR_USB_ENDPOINT,
  TREZOR_USB_FILTERS,
  TREZOR_USB_INTERFACE,
  TREZOR_USB_PRODUCT_ID,
  TREZOR_USB_VENDOR_ID,
  UsbTransportError,
  WebUsbTransport,
  type UsbDeviceLike,
  type UsbLike,
  type WebUsbOptions,
} from './transports/webusb';
export { FileCredentialStore, CredentialFileError } from './credentials-file';
