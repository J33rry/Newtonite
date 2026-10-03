export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://ops:ops@localhost:5433/ops',
  port: Number(process.env.PORT ?? 4000),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 24 * 7),
  /** Items in progress with no activity for this long are surfaced as "stale". */
  staleAfterHours: Number(process.env.STALE_AFTER_HOURS ?? 72),
  worker: {
    pollIntervalMs: Number(process.env.WORKER_POLL_MS ?? 1000),
    batchSize: Number(process.env.WORKER_BATCH ?? 20),
    /** A job "running" longer than this is assumed to belong to a crashed worker and is retried. */
    lockTimeoutMs: Number(process.env.WORKER_LOCK_TIMEOUT_MS ?? 5 * 60_000),
  },
};
