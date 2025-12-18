type Resolver<T> = (result: IteratorResult<T>) => void;
type Rejecter = (err: unknown) => void;

export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly pending: Array<{ resolve: Resolver<T>; reject: Rejecter }> = [];
  private closed = false;
  private failure: unknown;

  push(value: T): void {
    if (this.closed) throw new Error("Cannot push into a closed queue");
    if (this.failure) throw this.failure;
    const waiter = this.pending.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  next(): Promise<IteratorResult<T>> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.values.length) {
      const value = this.values.shift()!;
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  close(): void {
    this.closed = true;
    while (this.pending.length) {
      const waiter = this.pending.shift();
      waiter?.resolve({ value: undefined as never, done: true });
    }
  }

  fail(err: unknown): void {
    this.failure = err ?? new Error("AsyncQueue failure");
    while (this.pending.length) {
      const waiter = this.pending.shift();
      waiter?.reject(this.failure);
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }
}
