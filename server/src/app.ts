import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { Database } from './db.js';
import { ActorCache, authenticate } from './http/auth.js';
import { errorHandler } from './http/errors.js';
import type { RealtimeHub } from './realtime.js';
import { itemRoutes } from './routes/items.js';
import { publicRoutes, sessionRoutes } from './routes/misc.js';

export interface AppDeps {
  db: Database;
  hub: RealtimeHub;
  devLogin?: boolean;
  logger?: boolean;
  /** How long a resolved session may be served from memory (0 disables). Invalidation is push-based. */
  actorCacheTtlMs?: number;
}

export async function buildApp({ db, hub, devLogin = true, logger = true, actorCacheTtlMs = 10_000 }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: process.env.LOG_LEVEL ?? 'info' } : false });
  await app.register(cookie);
  app.setErrorHandler(errorHandler);
  const actors = new ActorCache(hub, actorCacheTtlMs);
  app.decorate('actors', actors);

  publicRoutes(app, db, { devLogin });

  // Everything else requires a session; authorization is then checked per resource in the services.
  await app.register(async (secured) => {
    secured.addHook('preHandler', authenticate(db, actors));
    sessionRoutes(secured, db, hub, actors);
    itemRoutes(secured, db);
  });

  return app;
}
