import pg from 'pg';

/** NOTIFYed by a statement-level trigger on `jobs` (migration 0001) whenever jobs are enqueued. */
export const JOBS_CHANNEL = 'ops_jobs';

export interface WakeupLogger {
  error(...args: unknown[]): void;
}

/**
 * Lets an idle worker sleep until a job is enqueued instead of polling the jobs table every second.
 *
 * The notification is only a hint: workers still claim with SKIP LOCKED, so several workers waking
 * for one job is harmless, and a missed hint only delays a job until the fallback poll. While the
 * LISTEN connection is down `listening` is false and the worker falls back to short polling.
 */
export class JobWakeup {
  private client: pg.Client | null = null;
  private wake: (() => void) | null = null;
  /** A hint that arrived while the worker was busy; the next wait() returns immediately. */
  private pending = false;
  private stopped = false;

  constructor(private readonly connectionString: string, private readonly log: WakeupLogger = console) {}

  get listening(): boolean {
    return this.client !== null;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', () => this.notify());
    client.on('error', (err) => {
      this.log.error('job wakeup LISTEN connection lost; reconnecting', err);
      this.client = null;
      client.end().catch(() => {});
      if (!this.stopped) setTimeout(() => this.start().catch((e) => this.log.error('job wakeup reconnect failed', e)), 1000);
    });
    await client.connect();
    await client.query(`LISTEN ${JOBS_CHANNEL}`);
    this.client = client;
    this.notify(); // jobs may have been enqueued while we were not listening
  }

  /** Resolves after `ms`, or as soon as a job is enqueued (or one was enqueued since the last wait). */
  wait(ms: number): Promise<void> {
    if (this.pending || this.stopped) {
      this.pending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(timer);
        if (self.wake === done) self.wake = null;
        resolve();
      }
      this.wake = done;
    });
  }

  private notify(): void {
    if (this.wake) this.wake();
    else this.pending = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => {});
  }
}
