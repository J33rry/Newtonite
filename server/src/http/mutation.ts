import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Database, Tx } from '../db.js';
import { idempotencyKeys } from '../db/schema.js';
import { AppError } from '../domain/types.js';

/**
 * Runs a mutation in a transaction, honouring an optional `Idempotency-Key` header.
 *
 * The key is claimed with INSERT … ON CONFLICT DO NOTHING inside the SAME transaction as the
 * mutation. That gives the right behaviour in every retry scenario without extra locking:
 *   * sequential retry after success  -> the key row exists; the stored response is replayed;
 *   * concurrent duplicate (double click, client retry while the first is in flight) -> the second
 *     INSERT blocks on the first transaction's uncommitted row, then sees the conflict and replays;
 *   * the first attempt failed / rolled back -> the key row vanished with it, so a retry executes.
 * Reusing a key for a different request is rejected rather than silently returning the wrong result.
 */
export async function runMutation<T>(
  db: Database,
  req: FastifyRequest,
  reply: FastifyReply,
  fn: (tx: Tx) => Promise<T>,
  successStatus = 200,
): Promise<T> {
  const key = req.headers['idempotency-key'];
  if (Array.isArray(key) || (key !== undefined && (key.length < 8 || key.length > 200))) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be a single value of 8-200 characters');
  }

  const result = await db.transaction(async (tx: Tx) => {
    const keyMatch = () => and(eq(idempotencyKeys.user_id, req.actor.id), eq(idempotencyKeys.key, key!));
    if (key) {
      const requestHash = createHash('sha256')
        .update(`${req.method} ${req.routeOptions.url} ${JSON.stringify(req.params)} ${JSON.stringify(req.body ?? null)}`)
        .digest('hex');
      const claimed = await tx
        .insert(idempotencyKeys)
        .values({ user_id: req.actor.id, key, request_hash: requestHash })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });
      if (!claimed.length) {
        const [stored] = await tx
          .select({ request_hash: idempotencyKeys.request_hash, status_code: idempotencyKeys.status_code, response: idempotencyKeys.response })
          .from(idempotencyKeys)
          .where(keyMatch());
        if (stored.request_hash !== requestHash) {
          throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
        }
        return { replayed: true as const, status: stored.status_code ?? successStatus, body: stored.response as T };
      }
    }

    const body = await fn(tx);
    if (key) {
      // Stored as JSON (dates become ISO strings), exactly as the client would have received it.
      await tx
        .update(idempotencyKeys)
        .set({ status_code: successStatus, response: JSON.parse(JSON.stringify(body ?? null)) })
        .where(keyMatch());
    }
    return { replayed: false as const, status: successStatus, body };
  });

  reply.code(result.status);
  if (result.replayed) reply.header('Idempotent-Replayed', 'true');
  return result.body;
}
