# Third-party notices

`dist/` is a self-contained bundle: the packages below are compiled into it.
Their licences require this notice to travel with the bundle.

| Package | Version | Licence |
|---|---|---|
| `@trezor/protocol` | 10.0.1 | MIT, Copyright (c) Trezor Company s.r.o. |
| `@noble/hashes` | 2.2.0 | MIT, Copyright (c) 2022 Paul Miller |
| `@noble/ciphers` | 2.2.0 | MIT, Copyright (c) 2022 Paul Miller |
| `buffer` | 6.0.3 | MIT, Copyright (c) Feross Aboukhadijeh, and other contributors |
| `base64-js` | 1.5.1 | MIT |
| `ieee754` | 1.2.1 | BSD-3-Clause |
| `@bufbuild/protobuf` | 2.12.0 | Apache-2.0 AND BSD-3-Clause |

`dist/webusb.*` and `dist/node-usb.*` compile in none of the above. The optional
peer `usb` (3.3.0, MIT, with its per-platform binaries `@node-usb/usb-*`, MIT) is
not bundled: `dist/node-usb.*` loads it by a dynamic import when a real device
is opened from Node.

Only `@trezor/protocol` of Trezor's packages is used. No code from
`@trezor/connect`, `@trezor/connect-core` or any other package of Trezor Suite
under the Trezor Reference Source License is used, copied or adapted.

## @trezor/protocol

    MIT License
    
    Copyright (c) Trezor Company s.r.o.
    
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

## The other packages

The full licence texts are in each package's `LICENSE` file in its npm tarball.
