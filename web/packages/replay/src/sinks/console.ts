import { ReplaySink, ReplaySinkContext, ReplaySinkMeta } from "./replay-sink";


export class ConsoleSink<T> implements ReplaySink<T> {
  constructor(private readonly prefix = "ReplaySink") {}

  open(meta?: ReplaySinkMeta): void {
    const suffix = meta?.stream ? ` (${meta.stream})` : "";
    console.info(`${this.prefix}${suffix} opened`, meta?.label ?? "");
  }

  write(item: T, ctx: ReplaySinkContext): void {
    const slotLabel = ctx.slot.toString();
    console.info(
      `${this.prefix} ${ctx.phase.toUpperCase()} slot=${slotLabel}`,
      item,
    );
  }

  close(err?: unknown): void {
    if (err) console.warn(`${this.prefix} closing with error`, err);
    else console.info(`${this.prefix} closed`);
  }
}
