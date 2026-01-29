/**
 * Event streams module exports.
 */

export { defineEventStream } from "./define";
export { runEventStreamProcessor, type ProcessorOptions, type ProcessorStats } from "./processor";
export type { EventStream, EventStreamDefinition } from "./types";
