export class SerialTaskQueue {
  private queue: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>) {
    const queuedTask = this.queue.then(task, task);
    this.queue = queuedTask.then(
      () => undefined,
      () => undefined,
    );
    return queuedTask;
  }
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
