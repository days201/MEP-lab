export type ParseJob = () => Promise<void>;

export class ParseJobRunner {
  private tail: Promise<void> = Promise.resolve();

  enqueue(job: ParseJob): Promise<void> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }

  async waitForIdle(): Promise<void> {
    await this.tail;
  }
}
