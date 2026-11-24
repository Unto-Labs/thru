/**
 * Whole operations on one connection, one after the other (plan B11).
 *
 * The client serializes single exchanges. A request of the Thru app is more
 * than one: a transaction is `SignTx` and then a `TxDataAck` for every piece
 * the app asks for, and loading the app is a conversation of several
 * messages. A request that slipped in between two of them would meet a device
 * that waits for something else and answers with a failure, so everything
 * that is a conversation runs here, as one operation, and the next operation
 * starts when the one before it is over. The Rust host does the same by
 * holding the signer's lock across the whole exchange.
 *
 * Operations are kept per connection object (a `WeakMap`), so that the app
 * loader and every {@link ThruApp} on one client share one line without the
 * client having to know about them.
 */
import { abortable } from './clock';
import { TrezorAbortedError } from './errors';

/** The end of the last operation started on a connection; it never rejects. */
const lines = new WeakMap<object, Promise<void>>();

/**
 * Runs `run` when every operation started earlier on `connection` is over, and
 * holds the connection until `run` settles. A `signal` that fires while the
 * operation waits ends it with {@link TrezorAbortedError} and nothing has been
 * sent; the operations behind it keep their order and wait for the ones
 * before it as they would have.
 */
export function exclusive<T>(connection: object, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  const previous = lines.get(connection) ?? Promise.resolve();
  let release!: () => void;
  lines.set(
    connection,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return (async (): Promise<T> => {
    try {
      await abortable(previous, signal, () => new TrezorAbortedError());
      if (signal?.aborted === true) throw new TrezorAbortedError();
      return await run();
    } finally {
      // The next operation starts when this one is over and the one before it
      // is too (an operation that was cut off while it waited never ran).
      void previous.then(release);
    }
  })();
}
