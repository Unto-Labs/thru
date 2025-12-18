import { Slot } from "../types";

export interface ReplaySinkContext {
  slot: Slot;
  phase: "backfill" | "live";
}

export interface ReplaySinkMeta {
  stream?: string;
  label?: string;
}

export interface ReplaySink<T> {
  open?(meta?: ReplaySinkMeta): Promise<void> | void;
  write(item: T, ctx: ReplaySinkContext): Promise<void> | void;
  close?(err?: unknown): Promise<void> | void;
}
