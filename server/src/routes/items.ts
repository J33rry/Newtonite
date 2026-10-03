import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { ITEM_TYPES } from '../domain/types.js';
import { ACTIONS } from '../domain/workflow.js';
import { runMutation } from '../http/mutation.js';
import * as items from '../services/items.js';
import { insights, insightsQuerySchema } from '../services/insights.js';
import { COUNT_CAP, countItems, dashboard, listItems, listQuerySchema } from '../services/listing.js';

const idParams = z.object({ id: z.uuid() });
const isoDate = z.iso.datetime({ offset: true }).nullable();

const createBody = z.object({
  teamId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).default(''),
  type: z.enum(ITEM_TYPES),
  priority: z.number().int().min(1).max(4),
  requiresApproval: z.boolean().default(false),
  dueAt: isoDate.default(null),
});

const updateBody = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  type: z.enum(ITEM_TYPES).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  dueAt: isoDate.optional(),
});

const transitionBody = z.object({
  expectedVersion: z.number().int().positive(),
  action: z.enum(ACTIONS),
  reason: z.string().max(2000).optional(),
});

const assignBody = z.object({ expectedVersion: z.number().int().positive(), assigneeId: z.uuid().nullable() });
const transferBody = z.object({ expectedVersion: z.number().int().positive(), teamId: z.uuid() });
const commentBody = z.object({ body: z.string().trim().min(1).max(10_000) });
const eventsQuery = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });

/**
 * Mutations are task-oriented endpoints (claim, transition, assign…) rather than a generic PATCH of
 * the whole resource: each one carries its own authorization rule, concurrency strategy and history
 * event. Every mutation returns the full, fresh item so clients can reconcile optimistic state.
 */
export function itemRoutes(app: FastifyInstance, db: Database) {
  const detail = (actorId: Parameters<typeof items.getItemDetail>[1], id: string) => items.getItemDetail(db, actorId, id);

  app.get('/api/dashboard', async (req) => dashboard(db, req.actor));

  app.get('/api/insights', async (req) => insights(db, req.actor, insightsQuerySchema.parse(req.query)));

  app.get('/api/items', async (req) => {
    const query = listQuerySchema.parse(req.query);
    // The (capped) total is only computed for the first page; later pages reuse the client's copy.
    const [page, total] = await Promise.all([
      listItems(db, req.actor, query),
      query.cursor ? Promise.resolve(null) : countItems(db, req.actor, query),
    ]);
    return { ...page, total: total === null ? null : Math.min(total, COUNT_CAP), totalCapped: total !== null && total > COUNT_CAP };
  });

  app.get('/api/items/:id', async (req) => detail(req.actor, idParams.parse(req.params).id));

  app.get('/api/items/:id/events', async (req) => {
    const { id } = idParams.parse(req.params);
    const q = eventsQuery.parse(req.query);
    return items.getEvents(db, req.actor, id, q.before ?? null, q.limit);
  });

  app.post('/api/items', async (req, reply) => {
    const body = createBody.parse(req.body);
    const created = await runMutation(db, req, reply, (tx) => items.createItem(tx, req.actor, body), 201);
    return created;
  });

  app.patch('/api/items/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { expectedVersion, ...patch } = updateBody.parse(req.body);
    await runMutation(db, req, reply, (tx) => items.updateItem(tx, req.actor, id, expectedVersion, patch));
    return detail(req.actor, id);
  });

  app.post('/api/items/:id/claim', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await runMutation(db, req, reply, (tx) => items.claimItem(tx, req.actor, id));
    return detail(req.actor, id);
  });

  app.post('/api/items/:id/release', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await runMutation(db, req, reply, (tx) => items.releaseItem(tx, req.actor, id));
    return detail(req.actor, id);
  });

  app.post('/api/items/:id/assign', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = assignBody.parse(req.body);
    await runMutation(db, req, reply, (tx) => items.assignItem(tx, req.actor, id, body.expectedVersion, body.assigneeId));
    return detail(req.actor, id);
  });

  app.post('/api/items/:id/transition', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = transitionBody.parse(req.body);
    await runMutation(db, req, reply, (tx) =>
      items.transitionItem(tx, req.actor, id, body.expectedVersion, body.action, body.reason),
    );
    return detail(req.actor, id);
  });

  app.post('/api/items/:id/transfer', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = transferBody.parse(req.body);
    await runMutation(db, req, reply, (tx) => items.transferItem(tx, req.actor, id, body.expectedVersion, body.teamId));
    // After a transfer the actor may no longer be able to see the item.
    return detail(req.actor, id).catch(() => ({ id, transferred: true }));
  });

  app.post('/api/items/:id/comments', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { body } = commentBody.parse(req.body);
    return runMutation(db, req, reply, (tx) => items.addComment(tx, req.actor, id, body), 201);
  });

  app.put('/api/items/:id/watch', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    return runMutation(db, req, reply, (tx) => items.setWatching(tx, req.actor, id, true));
  });

  app.delete('/api/items/:id/watch', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    return runMutation(db, req, reply, (tx) => items.setWatching(tx, req.actor, id, false));
  });
}
